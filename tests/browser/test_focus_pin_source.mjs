// Focus says where a part's pin names came from, and which are unverified.
// Governed by docs/specs/focus-pin-source.md

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('focus-pin-source');

const dir = mkdtempSync(join(tmpdir(), 'stripex-pinsource-'));
process.env.STRIPEX_BOARDS_DIR = dir;
process.env.STRIPEX_DEVICES_FILE = join(dir, 'devices.json');

let chromium = null;
let importError = null;
try { ({ chromium } = await import('playwright')); } catch (e) { importError = e.message; }

let browser = null;
let server = null;
let base = '';
let mod = null;
let launchError = null;

if (chromium) {
  try {
    mod = await import('../../src/server/index.js');
    server = createServer(mod.app);
    mod.attachLive(server);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  } catch (e) { launchError = e.message.split('\n')[0]; }
}

const needBrowser = () => ok(browser, `a browser is needed and there is none: ${importError ?? launchError}`);
const post = (p, body) => fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

s.check('A CATALOGUE PART SHOWS ITS PIN SOURCE AND UNVERIFIED PINS; A PLAIN PART SHOWS NEITHER', async () => {
  needBrowser();
  const made = await post('/api/boards', { name: 'pin-source', cols: 24, rows: 14 });
  const placed = await post(`/api/boards/${made.slug}/ops`, { ops: [
    { op: 'addPart', device: 'tmc2209', at: { col: 3, row: 2 } },
    { op: 'addPart', part: 'res-axial', at: { col: 18, row: 2 } },
  ] });
  const [chip, res] = placed.refs;

  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  page.setDefaultNavigationTimeout(20000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const r = {};
  const focusOn = async (ref) => {
    await page.keyboard.press('Escape');
    await page.locator(`#boardWrap [data-kind="part"][data-ref="${ref}"] [data-kind="part-body"]`).click({ force: true });
    await page.waitForTimeout(300);
    await page.locator('.tab[data-tab="inspect"]').click();
    await page.waitForTimeout(200);
    return page.evaluate(() => ({
      source: document.querySelector('#tab-inspect [data-focus-pinsource]')?.innerText ?? null,
      unverified: document.querySelector('#tab-inspect [data-focus-unverified]')?.innerText ?? null,
      part: document.querySelector('#tab-inspect .field span:nth-child(2)')?.innerText ?? null,
    }));
  };
  try {
    await page.addInitScript((slug) => localStorage.setItem('stripex.openBoard', slug), made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap [data-kind="part"]');
    await page.waitForTimeout(500);
    r.chip = await focusOn(chip);
    r.res = await focusOn(res);
  } finally { await context.close(); }

  ok(/SilentStepStick/.test(r.chip.source ?? ''), `the TMC2209 says where its names came from: "${r.chip.source}"`);
  ok(/NC3/.test(r.chip.unverified ?? '') && /NC4/.test(r.chip.unverified ?? ''),
    `and names NC3 and NC4 as unverified: "${r.chip.unverified}"`);
  eq({ source: r.res.source, unverified: r.res.unverified }, { source: null, unverified: null },
    'a plain resistor shows neither');
  // Found looking at the screenshot: a TMC2209 was called "DIP / IC socket".
  ok(/TMC2209/.test(r.chip.part ?? ''), `Focus names the device, not its footprint: "${r.chip.part}"`);
  eq(r.res.part, 'Resistor (axial)', 'a plain part keeps its own name');
  eq(errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
