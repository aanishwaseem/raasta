import { chromium, CHROME, openFlutter, tap, fill, waitText, bodyText, has, sleep, tapInput, texts } from './lib.mjs';
const stamp = Date.now();
const dName = `E2E Driver ${stamp}`;
const dEmail = `e2e.driver.${stamp}@x.test`;
const pName = `E2E Rider ${stamp}`;
const pEmail = `e2e.rider.${stamp}@x.test`;
const log = (m) => console.log(`[${((Date.now() - stamp) / 1000).toFixed(0)}s] ${m}`);
const b = await chromium.launch({ executablePath: CHROME });
const PICKUP = { latitude: 31.5102, longitude: 74.3441 };
const DROPOFF = { latitude: 31.4672, longitude: 74.2651 };

// ---- 1. driver signs up and completes onboarding in the driver app
const drv = await openFlutter(b, 'http://localhost:8081', { latitude: 31.5105, longitude: 74.3432 });
const d = drv.pg;
await tap(d, 'Create an account');
await fill(d, 'Full name', dName);
await fill(d, 'Email or phone (+92...)', dEmail);
await fill(d, 'Password (8+ characters, letters and numbers)', 'Passw0rd1');
await tap(d, 'Create account');
await waitText(d, 'Submit for review');
await tap(d, 'Add', 0);
await fill(d, 'CNIC (35202-1234567-1)', '35202-1234567-1');
await fill(d, 'Date of birth (YYYY-MM-DD)', '1990-05-14');
await fill(d, 'Licence number', 'LHR-998877');
await tap(d, 'Save'); await waitText(d, 'Redo');
await tap(d, 'Add', 0);
await fill(d, 'Make (Suzuki)', 'Suzuki'); await fill(d, 'Model (Cultus)', 'Cultus'); await fill(d, 'Year', '2020'); await fill(d, 'Colour', 'White'); await fill(d, 'Plate (LEA-19-1234)', `LEA-${String(stamp).slice(-6)}`);
await tap(d, 'Save');
for (let i = 0; i < 20 && ((await has(d, 'Upload')) || (await has(d, 'Add'))); i++) {
  if (!(await has(d, 'Upload'))) { await sleep(500); continue; }
  const [fc] = await Promise.all([d.waitForEvent('filechooser', { timeout: 10000 }), tap(d, 'Upload', 0)]);
  await fc.setFiles(new URL('./doc.png', import.meta.url).pathname); await sleep(2200);
}
await tap(d, 'Submit for review');
await waitText(d, 'Your application is with the Raasta team');
log('1 driver onboarded in the app and submitted for review');

// ---- 2. admin approves in the dashboard
const actx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const a = await actx.newPage();
a.on('dialog', (x) => x.accept('Checked and approved in e2e'));
a.on('pageerror', (e) => console.log('admin pageerror', e.message));
await a.goto('http://localhost:5173');
await a.fill('input[placeholder="Email or phone"]', 'admin@raasta.test'); await a.fill('input[type=password]', 'Passw0rd!test'); await a.click('button.primary');
await a.waitForSelector('nav');
await a.goto('http://localhost:5173/#drivers');
await a.waitForSelector('select');
await a.selectOption('select >> nth=0', 'PENDING_REVIEW');
await a.fill('input[placeholder="Search name or phone"]', dName);
await a.waitForSelector(`tr:has-text("${dName}")`);
await a.click(`tr:has-text("${dName}") button:text-is("Review")`);
await a.waitForSelector('[role=dialog] table');
for (let i = 0; i < 12; i++) {
  const n = await a.locator('[role=dialog] button:text-is("Approve")').count();
  if (n === 0) break;
  // approve everything pending (documents then vehicle); the final "Approve driver" is a different label
  await a.locator('[role=dialog] button:text-is("Approve")').first().click();
  await sleep(700);
}
await a.click('[role=dialog] button:text-is("Approve driver")');
await sleep(1000);
log('2 admin approved documents, vehicle and driver in the dashboard');

// ---- 3. driver continues: refresh, accept code of conduct, go online
await tap(d, 'Refresh'); await sleep(1500);
await waitText(d, 'You are approved.');
await tap(d, 'I have read and agree to the code of conduct');
await tap(d, 'Start driving');
await waitText(d, 'Go online');
await tap(d, 'Go online');
await waitText(d, 'You are online');
log('3 driver passed training and is online (real browser GPS)');

// ---- 4. rider signs in through the rider app (driven by screen coordinates: Flutter web's accessibility mode clears text fields when results appear)
const API = 'http://localhost:3000/api/v1';
const reg = await (await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: pName, email: pEmail, password: 'Passw0rd1', role: 'PASSENGER', device: { deviceId: `e2e-rider-${stamp}`, platform: 'web' } }) })).json();
const riderApi = async (path) => {
  const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${reg.tokens.accessToken}` } });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};
const rctx = await b.newContext({ viewport: { width: 420, height: 900 }, geolocation: PICKUP, permissions: ['geolocation'] });
const p = await rctx.newPage();
await p.goto('http://localhost:8080'); await sleep(5000);
const click = async (x, y) => { await p.mouse.click(x, y); await sleep(700); };
await click(210, 423); await p.keyboard.type(pEmail, { delay: 15 });
await click(210, 483); await p.keyboard.type('Passw0rd1', { delay: 15 });
await click(210, 548); await sleep(4500);
await click(210, 407); await p.keyboard.type('Emporium', { delay: 40 }); await sleep(2000);
await click(210, 458); await click(210, 468); await sleep(1500);
await p.$eval('flt-semantics-placeholder', (e) => e.click()); await sleep(900);   // text fields are done, so accessibility mode is safe from here
await tap(p, 'Economy');
await p.mouse.move(210, 600); await p.mouse.wheel(0, 600); await sleep(800);
await tap(p, 'Request ECONOMY');
await sleep(3000);
await p.screenshot({ path: 'pax-requested.png' });
let active = await riderApi('/rides/active');
log(`4 rider signed in via the app and requested a ride: ${active.status} ${active.productCode}`);

// ---- 5. driver accepts and runs the trip
await waitText(d, 'Accept', 30000);
await tap(d, 'Accept');
await waitText(d, 'Drive to pickup');
await tap(d, "I've arrived");
await waitText(d, 'Start trip');
log('5 driver accepted and arrived');
await sleep(3500);
active = await riderApi('/rides/active');
const pin = active.pin;
log(`   rider's ride is ${active.status}, driver ${active.driver?.firstName}, PIN ${pin}`);
await p.screenshot({ path: 'pax-assigned.png' });
await tapInput(d, 0);
await d.keyboard.type(pin, { delay: 30 });
await tap(d, 'Start trip');
await waitText(d, 'Complete trip');
log('6 trip started with PIN');
await drv.ctx.setGeolocation(DROPOFF);
await sleep(7000);
await tap(d, 'Complete trip');
await waitText(d, 'Back to driving', 20000);
await sleep(4000);
await p.screenshot({ path: 'pax-complete.png' });
const done = await riderApi(`/rides/${active.id}`);
if (done.status !== 'COMPLETED') throw new Error('ride not completed: ' + done.status);
log(`7 trip completed (${done.status}), fare Rs ${done.fare?.final}`);
await d.screenshot({ path: 'drv-complete.png' });
await b.close();
console.log('E2E OK', JSON.stringify({ dEmail, pEmail }));
