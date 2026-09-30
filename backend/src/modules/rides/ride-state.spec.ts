import { canTransition, RIDE_STATUSES, sourcesFor, TERMINAL_STATUSES, TRANSITIONS } from './ride-state';

describe('ride state machine', () => {
  it('allows the happy path only for the right actors', () => {
    expect(canTransition('MATCHING', 'DRIVER_ASSIGNED', 'DRIVER')).toBe(true);
    expect(canTransition('MATCHING', 'DRIVER_ASSIGNED', 'PASSENGER')).toBe(false);
    expect(canTransition('DRIVER_ARRIVED', 'IN_PROGRESS', 'DRIVER')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED', 'DRIVER')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED', 'PASSENGER')).toBe(false);
  });

  it('never allows leaving a terminal state', () => {
    for (const t of TERMINAL_STATUSES) {
      for (const to of RIDE_STATUSES) {
        expect(canTransition(t, to, 'ADMIN')).toBe(false);
        expect(canTransition(t, to, 'SYSTEM')).toBe(false);
      }
    }
  });

  it('passengers cannot cancel once the trip has started', () => {
    expect(canTransition('IN_PROGRESS', 'CANCELLED', 'PASSENGER')).toBe(false);
    expect(sourcesFor('CANCELLED', 'PASSENGER')).toEqual(['MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED']);
  });

  it('a driver cancellation before pickup returns the ride to matching', () => {
    expect(sourcesFor('MATCHING', 'DRIVER')).toEqual(['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED']);
  });

  it('defines every status', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...RIDE_STATUSES].sort());
  });
});
