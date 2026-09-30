import { DRIVERS, LIBERTY, Session, TestApp } from './harness';

/** Runs a ride up to IN_PROGRESS with one driver and returns ids plus the quote route ([lat, lng] points). */
export async function startTrip(t: TestApp, passenger: Session, driver: Session, at: { lat: number; lng: number } = DRIVERS.usman.at, body: Record<string, unknown> = {}) {
  await t.goOnline(driver, at);
  const quote = await t.quote(passenger);
  const res = await t.requestRide(passenger, quote, body);
  if (res.status !== 201) throw new Error(`request failed ${res.status} ${JSON.stringify(res.body)}`);
  const offer = await t.waitOffer(driver);
  await t.call(driver, 'post', `/driver/offers/${offer.offerId}/accept`);
  const view = (await t.call(passenger, 'get', `/rides/${res.body.id}`)).body;
  await t.call(driver, 'post', '/driver/location', { lat: LIBERTY.lat, lng: LIBERTY.lng });
  await t.call(driver, 'post', `/driver/rides/${res.body.id}/arrived`);
  await t.call(driver, 'post', `/driver/rides/${res.body.id}/start`, { pin: view.pin });
  return { rideId: res.body.id as string, route: quote.route as [number, number][], quote, pin: view.pin as string };
}

export async function endActiveRides(t: TestApp) {
  await t.db.query(`UPDATE rides SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'SYSTEM' WHERE status IN ('MATCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')`);
}
