import { Injectable, Logger, BeforeApplicationShutdown } from '@nestjs/common';
import { Job, JobsOptions, Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';
import { MetricsService } from '../metrics/metrics.service';

export const QUEUES = ['matching', 'scheduler', 'maintenance', 'notifications'] as const;
export type QueueName = (typeof QUEUES)[number];

type Processor = (data: any, job: Job) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Thin wrapper over BullMQ. Modules register named processors at bootstrap; workers are started
 * either inside the API (development) or in the dedicated worker process (production).
 * All processors must be idempotent: BullMQ guarantees at-least-once delivery.
 */
@Injectable()
export class QueueService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<QueueName, Queue>();
  private readonly processors = new Map<string, Processor>();
  private readonly workers: Worker[] = [];
  private readonly connections: Redis[] = [];

  constructor(
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  private queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      const conn = this.redis.create(`queue-${name}`);
      this.connections.push(conn);
      q = new Queue(name, { connection: conn, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } });
      this.queues.set(name, q);
    }
    return q;
  }

  register(queue: QueueName, jobName: string, processor: Processor): void {
    this.processors.set(`${queue}:${jobName}`, processor);
  }

  async add(queue: QueueName, jobName: string, data: unknown, opts: JobsOptions = {}): Promise<void> {
    await this.queue(queue).add(jobName, data, { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, ...opts });
  }

  async remove(queue: QueueName, jobId: string): Promise<void> {
    const job = await this.queue(queue).getJob(jobId);
    await job?.remove().catch(() => undefined);
  }

  async repeat(queue: QueueName, jobName: string, everyMs: number): Promise<void> {
    await this.queue(queue).upsertJobScheduler(`${jobName}-every`, { every: everyMs }, { name: jobName, data: {} });
  }

  async startWorkers(): Promise<void> {
    for (const name of QUEUES) {
      const conn = this.redis.create(`worker-${name}`);
      this.connections.push(conn);
      const worker = new Worker(
        name,
        async (job) => {
          const processor = this.processors.get(`${name}:${job.name}`);
          if (!processor) {
            this.logger.warn(`No processor for ${name}:${job.name}`);
            return;
          }
          try {
            const result = await processor(job.data, job);
            this.metrics.queueJobs.inc({ queue: name, outcome: 'completed' });
            return result;
          } catch (err) {
            this.metrics.queueJobs.inc({ queue: name, outcome: 'failed' });
            throw err;
          }
        },
        { connection: conn, concurrency: name === 'matching' ? 20 : 5 },
      );
      worker.on('failed', (job, err) => this.logger.warn(`Job ${name}:${job?.name} failed: ${err.message}`));
      this.workers.push(worker);
    }
    this.logger.log(`Started ${this.workers.length} queue workers`);
  }

  async stats(): Promise<Record<string, Record<string, number>>> {
    const out: Record<string, Record<string, number>> = {};
    for (const name of QUEUES) {
      out[name] = await this.queue(name).getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
    }
    return out;
  }

  async beforeApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    this.connections.forEach((c) => c.disconnect());
  }
}
