import { Injectable, OnModuleInit } from '@nestjs/common';
import { Gauge } from 'prom-client';
import { DatabaseService } from '../db/database.service';
import { QueueService } from '../queue/queue.service';
import { MetricsService } from './metrics.service';

/** Gauges read at scrape time: Postgres pool saturation and background-queue depth. */
@Injectable()
export class MetricsProbes implements OnModuleInit {
  constructor(
    private readonly metrics: MetricsService,
    private readonly db: DatabaseService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit() {
    const reg = this.metrics.registry;
    const pool = this.db.pool;
    new Gauge({ name: 'raasta_db_pool_connections', help: 'Postgres pool connections by state', labelNames: ['state'], registers: [reg],
      collect() { this.set({ state: 'total' }, pool.totalCount); this.set({ state: 'idle' }, pool.idleCount); this.set({ state: 'waiting' }, pool.waitingCount); } });
    const queue = this.queue;
    new Gauge({ name: 'raasta_queue_jobs', help: 'Background jobs by queue and state', labelNames: ['queue', 'state'], registers: [reg],
      async collect() {
        const stats = await queue.stats().catch(() => ({}) as Record<string, Record<string, number>>);
        for (const [q, counts] of Object.entries(stats)) for (const [state, n] of Object.entries(counts)) this.set({ queue: q, state }, n);
      } });
  }
}
