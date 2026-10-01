// Manual end-to-end smoke test of the ride flow against a running API + seeded DB.
// Usage: API=http://localhost:3000/api/v1 node scripts/smoke-ride.mjs
const API = process.env.API ?? 'http://localhost:3000/api/v1';
const PASS = process.env.SEED_TEST_PASSWORD ?? 'Passw0rd!test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let idem = 0;
async function call(token, method, path, body, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`), { status: res.status, json });
  return json;
}
const login = async (email) => (await call(null, 'POST', '/auth/login', { identifier: email, password: PASS, device: { deviceId: 'smoke', platform: 'web' } })).tokens.accessToken;
const step = (m) => console.log(`\n== ${m}`);

const pickup = { lat: 31.5102, lng: 74.3441, address: 'Liberty Market, Gulberg III, Lahore' };
const dropoff = { lat: 31.4672, lng: 74.2651, address: 'Emporium Mall, Johar Town, Lahore' };

const passenger = await login('bilal@raasta.test');
const drivers = {};
for (const [k, email, at] of [
  ['usman', 'usman@raasta.test', [31.5105, 74.3432]],
  ['hamza', 'hamza@raasta.test', [31.5002, 74.3501]],
]) {
  const t = await login(email);
  drivers[k] = { token: t, at };
  await call(t, 'POST', '/driver/online', { lat: at[0], lng: at[1] });
}
step('drivers online');

step('quote');
const quote = await call(passenger, 'POST', '/rides/quotes', { pickup, dropoff });
for (const o of quote.options) console.log(o.productCode, `rec Rs${o.fare.recommended} min Rs${o.fare.minimumReasonable}`, 'pickupETA', o.pickupEtaS, o.availability);
console.log('recommendations:', quote.recommendations.map((r) => `${r.kind}:${r.productCode}`).join(', '));

step('request ride (Idempotency-Key replay check)');
const key = `smoke-${Date.now()}`;
const body = { quoteId: quote.id, productCode: 'ECONOMY', paymentMethod: 'WALLET' };
const ride = await call(passenger, 'POST', '/rides', body, { 'idempotency-key': key });
const again = await call(passenger, 'POST', '/rides', body, { 'idempotency-key': key });
console.log('ride', ride.id, ride.status, 'replay same id:', again.id === ride.id);

step('driver receives offer');
let offerOwner = null, offer = null;
for (let i = 0; i < 20 && !offer; i++) {
  for (const [k, d] of Object.entries(drivers)) {
    const o = await call(d.token, 'GET', '/driver/offers/current');
    if (o) { offer = o; offerOwner = k; break; }
  }
  if (!offer) await sleep(500);
}
if (!offer) throw new Error('no offer arrived');
console.log('offer to', offerOwner, JSON.stringify(offer).slice(0, 400));
const d = drivers[offerOwner];
const accepted = await call(d.token, 'POST', `/driver/offers/${offer.offerId ?? offer.id}/accept`);
console.log('accepted ->', accepted.status);

step('passenger sees driver + PIN');
const pv = await call(passenger, 'GET', `/rides/${ride.id}`);
console.log(pv.status, 'pin', pv.pin, 'driver', pv.driver?.firstName, pv.driver?.vehicle?.plateNumber, 'badges', JSON.stringify(pv.driver?.badges));

step('driver moves to pickup, arrives');
await call(d.token, 'POST', '/driver/location', { lat: pickup.lat, lng: pickup.lng, speed: 5 });
await sleep(300);
console.log('status after ping:', (await call(passenger, 'GET', `/rides/${ride.id}`)).status);
await call(d.token, 'POST', `/driver/rides/${ride.id}/arrived`);

step('wrong PIN, then right PIN');
try { await call(d.token, 'POST', `/driver/rides/${ride.id}/start`, { pin: '0000' }); } catch (e) { console.log('wrong pin ->', e.json.error.code); }
const started = await call(d.token, 'POST', `/driver/rides/${ride.id}/start`, { pin: pv.pin });
console.log('started ->', started.status);

step('trip movement');
for (let i = 1; i <= 5; i++) {
  const f = i / 5;
  await call(d.token, 'POST', '/driver/location', { lat: pickup.lat + (dropoff.lat - pickup.lat) * f, lng: pickup.lng + (dropoff.lng - pickup.lng) * f, speed: 8 });
  await sleep(200);
}
step('complete');
const done = await call(d.token, 'POST', `/driver/rides/${ride.id}/complete`, { lat: dropoff.lat, lng: dropoff.lng }, { 'idempotency-key': `c-${ride.id}` });
console.log('completed ->', done.ride.status, 'payment', JSON.stringify(done.payment));

step('rate, receipt, wallet, earnings');
console.log('rating', JSON.stringify(await call(passenger, 'POST', `/rides/${ride.id}/rating`, { stars: 5, tags: ['POLITE', 'SAFE_DRIVING'] })));
const receipt = await call(passenger, 'GET', `/rides/${ride.id}/receipt`);
console.log('receipt charged', receipt.fare.charged, receipt.paymentStatus);
console.log('passenger wallet', JSON.stringify(await call(passenger, 'GET', '/wallet')));
console.log('driver earnings', JSON.stringify((await call(d.token, 'GET', '/driver/earnings')).net));
console.log('driver wallet', JSON.stringify(await call(d.token, 'GET', '/driver/wallet')));
for (const t of Object.values(drivers)) await call(t.token, 'POST', '/driver/offline').catch(() => {});
console.log('\nSMOKE OK');
