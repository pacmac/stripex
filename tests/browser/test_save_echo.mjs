// A save's own echo on the live feed must not be mistaken for someone else's change.
// Governed by docs/specs/save-echo.md
//
// Found 2026-09-17: the side-switch check's undo failed only under the full
// suite's load. When a save's response is slow, the live feed delivers the saved
// board first; the editor does not yet know that version is its own, applies it
// as a foreign change, and history.reset() wipes the undo stack — so Ctrl+Z
// does nothing. Made deterministic here by holding the save's response back.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('save-echo');

const dir = mkdtempSync(join(tmpdir(), 'stripex-echo-'));
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

s.check('WITH A SLOW SAVE RESPONSE, AN EDIT CAN STILL BE UNDONE', async () => {
  needBrowser();
  const made = await post('/api/boards', { name: 'echo', cols: 14, rows: 10 });
  await post(`/api/boards/${made.slug}/ops`, { ops: [{ op: 'addPart', part: 'res-axial', at: { col: 4, row: 2 } }] });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  page.setDefaultNavigationTimeout(20000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const r = {};
  try {
    await page.addInitScript((slug) => localStorage.setItem('stripex.openBoard', slug), made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap [data-kind="part"][data-ref="R1"]');
    await page.waitForTimeout(600);
    // Hold every save's RESPONSE back 1.5 s: the write lands at once, the live
    // feed announces it, and only then does the editor hear back from its PUT.
    await page.route('**/api/boards/*', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      const res = await route.fetch();
      await new Promise((ok_) => setTimeout(ok_, 1500));
      return route.fulfill({ response: res });
    });
    await page.locator('#boardWrap [data-kind="part"][data-ref="R1"] [data-kind="part-body"]').click({ force: true });
    await page.waitForTimeout(300);
    await page.locator('[data-edit-side="copper"]').click();
    // Past the save's debounce and the feed's echo, and past the held response.
    await page.waitForTimeout(2600);
    r.after = await page.locator('#boardWrap [data-kind="part"][data-ref="R1"]').getAttribute('data-side');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    r.undone = await page.locator('#boardWrap [data-kind="part"][data-ref="R1"]').getAttribute('data-side');
    r.banner = await page.evaluate(() => [...document.querySelectorAll('.banner')].map((b) => b.innerText).join(' '));
  } finally { await context.close(); }

  eq(r.after, 'copper', 'the edit landed');
  eq(r.undone, 'top', 'and undo still puts it back after a slow save');
  ok(!/changed on the server/.test(r.banner), `no false "changed on the server" banner: "${r.banner}"`);
  eq(errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
