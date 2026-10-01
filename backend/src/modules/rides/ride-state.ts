export const RIDE_STATUSES = [
  'MATCHING',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVERS',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

export const ACTIVE_STATUSES: RideStatus[] = ['MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'];
export const DRIVER_ACTIVE_STATUSES: RideStatus[] = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'];
export const TERMINAL_STATUSES: RideStatus[] = ['COMPLETED', 'CANCELLED', 'NO_DRIVERS'];
export const PASSENGER_CANCELLABLE: RideStatus[] = ['MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'];

export type Actor = 'PASSENGER' | 'DRIVER' | 'SYSTEM' | 'ADMIN';

/** The single source of truth for allowed transitions and who may trigger them. */
export const TRANSITIONS: Record<RideStatus, Partial<Record<RideStatus, Actor[]>>> = {
  MATCHING: { DRIVER_ASSIGNED: ['DRIVER'], CANCELLED: ['PASSENGER', 'SYSTEM', 'ADMIN'], NO_DRIVERS: ['SYSTEM'] },
  DRIVER_ASSIGNED: {
    DRIVER_ARRIVING: ['SYSTEM', 'DRIVER'],
    DRIVER_ARRIVED: ['DRIVER'],
    MATCHING: ['DRIVER', 'ADMIN'],
    CANCELLED: ['PASSENGER', 'SYSTEM', 'ADMIN'],
  },
  DRIVER_ARRIVING: { DRIVER_ARRIVED: ['DRIVER'], MATCHING: ['DRIVER', 'ADMIN'], CANCELLED: ['PASSENGER', 'SYSTEM', 'ADMIN'] },
  DRIVER_ARRIVED: { IN_PROGRESS: ['DRIVER'], MATCHING: ['DRIVER', 'ADMIN'], CANCELLED: ['PASSENGER', 'DRIVER', 'SYSTEM', 'ADMIN'] },
  IN_PROGRESS: { COMPLETED: ['DRIVER', 'ADMIN'], CANCELLED: ['ADMIN'] },
  COMPLETED: {},
  CANCELLED: {},
  NO_DRIVERS: {},
};

export function canTransition(from: RideStatus, to: RideStatus, actor: Actor): boolean {
  return TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
}

/** Statuses from which `to` may be reached by `actor` (used to build conditional UPDATEs). */
export function sourcesFor(to: RideStatus, actor: Actor): RideStatus[] {
  return (Object.keys(TRANSITIONS) as RideStatus[]).filter((from) => canTransition(from, to, actor));
}

export const EVENT_FOR_STATUS: Partial<Record<RideStatus, string>> = {
  MATCHING: 'ride.matching',
  DRIVER_ASSIGNED: 'ride.driver_assigned',
  DRIVER_ARRIVING: 'ride.driver_arriving',
  DRIVER_ARRIVED: 'ride.driver_arrived',
  IN_PROGRESS: 'ride.started',
  COMPLETED: 'ride.completed',
  CANCELLED: 'ride.cancelled',
  NO_DRIVERS: 'ride.no_drivers',
};
