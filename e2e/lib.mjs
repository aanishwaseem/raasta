import { chromium } from 'playwright-core';
export const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openFlutter(browser, url, geo) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, geolocation: geo, permissions: ['geolocation'] });
  const pg = await ctx.newPage();
  await pg.goto(url);
  await pg.waitForSelector('flt-semantics-placeholder', { state: 'attached', timeout: 30000 });
  await pg.$eval('flt-semantics-placeholder', (e) => e.click());
  await sleep(800);
  return { ctx, pg };
}

/** Visible text of the whole semantics tree. */
export const texts = (pg) => pg.evaluate(() => [...document.querySelectorAll('flt-semantics')].map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim()).filter(Boolean));
export const bodyText = async (pg) => (await texts(pg)).join(' | ');

const own = `(e) => [...e.childNodes].filter((c) => c.nodeType === 3 || c.nodeName === 'SPAN').map((c) => c.textContent).join('').trim()`;

async function rectOf(pg, text, nth = 0) {
  return pg.evaluate(([t, n, ownSrc]) => {
    const ownText = eval(ownSrc);
    const nodes = [...document.querySelectorAll('flt-semantics')];
    const exact = [];
    const loose = [];
    for (const e of nodes) {
      const lab = (e.getAttribute('aria-label') || '').trim();
      const inp = e.querySelector(':scope > input, :scope > textarea');
      const o = ownText(e);
      if (inp && (inp.getAttribute('aria-label') || '').trim() === t) exact.push(e);
      else if (o === t || lab === t) exact.push(e);
      else if (o.includes(t) || lab.includes(t)) loose.push(e);
    }
    const el = (exact.length ? exact : loose)[n];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  }, [text, nth, own]);
}

export async function waitText(pg, text, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await rectOf(pg, text)) return true;
    await sleep(300);
  }
  throw new Error(`timeout waiting for text "${text}". Screen: ${(await bodyText(pg)).slice(0, 500)}`);
}

export async function tap(pg, text, nth = 0) {
  await waitText(pg, text);
  const r = await rectOf(pg, text, nth);
  await pg.mouse.click(r.x, r.y);
  await sleep(500);
}

/** Tap a field by its label then type. */
export async function fill(pg, label, value, nth = 0) {
  await tap(pg, label, nth);
  await pg.keyboard.press('Control+A');
  await pg.keyboard.type(value, { delay: 15 });
  await sleep(300);
}
export const has = async (pg, text) => !!(await rectOf(pg, text));
export { chromium };

/** Tap the n-th text input on the Flutter page (for fields without a label). */
export async function tapInput(pg, n = 0) {
  const r = await pg.evaluate((i) => {
    const el = [...document.querySelectorAll('flt-semantics > input, flt-semantics > textarea')][i];
    if (!el) return null;
    const b = el.parentElement.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, n);
  if (!r) throw new Error('no input #' + n);
  await pg.mouse.click(r.x, r.y);
  await sleep(400);
}
