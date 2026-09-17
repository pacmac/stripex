// One toggle runs its handler once, however long the session has been.
// Governed by docs/specs/left-panel-cards.md ("a card's listeners are attached once")
//
// Peter, 2026-09-17: "there's something weir happening when I enable/disable a
// layer, it seems to hang, and repeated toggle makes no difference".
//
// Measured on a copy of his board: 302, 330, 390, 437, 661, 782, 1314, 2382 ms
// for eight toggles. paintLayers added a change listener to the card body on
// every repaint, the body survives the repaint, and draw() repaints Layers on
// every change — so one toggle ran one full redraw per edit so far. Counted
// here by what each handler writes, not by timing, so the check is exact.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('card-listeners');

const dir = mkdtempSync(join(tmpdir(), 'stripex-listeners-'));
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

async function onBoard(fn) {
  const made = await fetch(`${base}/api/boards`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `listeners-${Date.now()}`, cols: 14, rows: 10 }),
  }).then((x) => x.json());
  await fetch(`${base}/api/boards/${made.slug}/ops`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ops: [{ op: 'addPart', part: 'res-axial', at: { col: 3, row: 2 } }] }),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.addInitScript((slug) => {
      localStorage.setItem('stripex.openBoard', slug);
      // Count writes per key, so a handler that ran N times is seen N times.
      window.__writes = {};
      // And count change listeners attached to each card body directly: a
      // repeated handler that writes the same thing twice can hide behind a
      // store that keeps only distinct snapshots.
      window.__cardListeners = {};
      const realAdd = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, fn, opts) {
        const card = this?.dataset?.cardbody;
        if (card && type === 'change') {
          window.__cardListeners[card] = (window.__cardListeners[card] ?? 0) + 1;
        }
        return realAdd.call(this, type, fn, opts);
      };
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        window.__writes[k] = (window.__writes[k] ?? 0) + 1;
        return real.call(this, k, v);
      };
    }, made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap [data-kind="part"]');
    await page.waitForTimeout(500);
    return { ...(await fn(page)), errs };
  } finally { await context.close(); }
}

s.check('A LAYER TOGGLE WRITES ITS SETTING ONCE, EVEN AFTER MANY TOGGLES', async () => {
  needBrowser();
  const r = await onBoard(async (page) => {
    await page.locator('[data-cardtoggle="layers"]').click();
    await page.waitForTimeout(200);
    const box = () => page.locator('[data-cardbody="layers"] input[data-layer="netNames"]');
    // A session's worth of repaints.
    for (let i = 0; i < 8; i += 1) { await box().click(); await page.waitForTimeout(120); }
    await page.evaluate(() => { window.__writes = {}; });
    await box().click();
    await page.waitForTimeout(300);
    return { writes: await page.evaluate(() => window.__writes['stripex.layers'] ?? 0) };
  });
  eq(r.writes, 1, `one toggle, one write of the layer settings (got ${r.writes})`);
  eq(r.errs, [], 'no page errors');
});

s.check('A RULE TOGGLE COMMITS ONCE, EVEN AFTER MANY TOGGLES', async () => {
  needBrowser();
  const r = await onBoard(async (page) => {
    await page.locator('[data-cardtoggle="rules"]').click();
    await page.waitForTimeout(200);
    const box = () => page.locator('[data-cardbody="rules"] input[type="checkbox"]').first();
    // The Rules card is repainted by paintCards, which runs whenever a tool is
    // armed — so arming the select tool a few times is a session's worth.
    for (let i = 0; i < 6; i += 1) {
      await page.locator('.tool[data-tool="select"]').click();
      await page.waitForTimeout(120);
    }
    await box().click();
    await page.waitForTimeout(400);
    return { listeners: await page.evaluate(() => window.__cardListeners.rules ?? 0) };
  });
  ok(r.listeners <= 1, `the Rules card has one change listener, not one per repaint (got ${r.listeners})`);
  eq(r.errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
