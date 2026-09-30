import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'raasta_http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  readonly failedRequests = new Counter({
    name: 'raasta_http_failed_requests_total',
    help: 'HTTP requests that ended in an error response',
    labelNames: ['status', 'code'],
    registers: [this.registry],
  });
  readonly matchLatency = new Histogram({
    name: 'raasta_ride_match_latency_seconds',
    help: 'Time from ride request to driver assignment',
    buckets: [1, 5, 10, 20, 30, 60, 120, 300],
    registers: [this.registry],
  });
  readonly matchOutcomes = new Counter({
    name: 'raasta_ride_match_outcomes_total',
    help: 'Matching outcomes',
    labelNames: ['outcome'],
    registers: [this.registry],
  });
  readonly socketConnections = new Gauge({
    name: 'raasta_socket_connections',
    help: 'Open WebSocket connections',
    labelNames: ['role'],
    registers: [this.registry],
  });
  readonly paymentFailures = new Counter({
    name: 'raasta_payment_failures_total',
    help: 'Failed payments',
    labelNames: ['method', 'reason'],
    registers: [this.registry],
  });
  readonly aiLatency = new Histogram({
    name: 'raasta_ai_prediction_latency_seconds',
    help: 'Latency of AI service calls',
    labelNames: ['endpoint'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.4, 1],
    registers: [this.registry],
  });
  readonly aiFallbacks = new Counter({
    name: 'raasta_ai_fallback_total',
    help: 'AI calls that fell back to in-process baseline',
    labelNames: ['endpoint', 'reason'],
    registers: [this.registry],
  });
  readonly safetyEvents = new Counter({
    name: 'raasta_safety_events_total',
    help: 'Safety events created',
    labelNames: ['type', 'severity'],
    registers: [this.registry],
  });
  readonly queueJobs = new Counter({
    name: 'raasta_queue_jobs_total',
    help: 'Background jobs processed',
    labelNames: ['queue', 'outcome'],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'raasta_' });
  }
}
