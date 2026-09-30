import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

/**
 * In-process domain event bus. Handlers run asynchronously after the emitting transaction has
 * committed (callers emit after commit). A failing handler is logged and never breaks the emitter.
 * Replacing this with Redis Streams / Kafka is the first step when extracting services.
 */
export interface DomainEvents {
  'ride.requested': { rideId: string };
  'ride.assigned': { rideId: string; driverId: string };
  'ride.started': { rideId: string };
  'ride.completed': { rideId: string };
  'ride.cancelled': { rideId: string; by: string; driverId?: string | null };
  'ride.no_drivers': { rideId: string };
  'ride.driver_cancelled': { rideId: string; driverId: string };
  'driver.location': { driverId: string; rideIds: string[]; lat: number; lng: number; speedMps?: number; recordedAt: Date };
  'payment.failed': { userId: string; rideId?: string; reason: string };
  'user.registered': { userId: string; deviceId?: string };
  'safety.event_created': { eventId: string; rideId: string | null; type: string; severity: string };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => Promise<void> | void;

@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly emitter = new EventEmitter();
  private pending = new Set<Promise<void>>();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof DomainEvents>(event: K, handler: Handler<K>): void {
    this.emitter.on(event, (payload: DomainEvents[K]) => {
      const p = Promise.resolve()
        .then(() => handler(payload))
        .catch((err: Error) => this.logger.error(`Handler for ${event} failed: ${err.message}`, err.stack))
        .finally(() => this.pending.delete(p));
      this.pending.add(p);
    });
  }

  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  /** Test helper: wait until all in-flight handlers settle. */
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
