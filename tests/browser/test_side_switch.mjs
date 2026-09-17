// Switching a part to the other side of the board, from the Focus panel.
// Governed by docs/specs/switchable-side.md
//
// Peter, 2026-09-17: "an item / component / object needs to be able to switch
// layer but have a default layer, mostly top."

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('side-switch');

const dir = mkdtempSync(join(tmpdir(), 'stripex-side-'));
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

const post = (path, body) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

s.check('FOCUS OFFERS TOP / COPPER SIDE, SWITCHING GHOSTS IT, AND UNDO PUTS IT BACK', async () => {
  needBrowser();
  const made = await post('/api/boards', { name: 'side-switch', cols: 14, rows: 10 });
  await post(`/api/boards/${made.slug}/ops`, { ops: [{ op: 'addPart', part: 'res-axial', at: { col: 4, row: 2 } }] });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  let r;
  try {
    await page.addInitScript((slug) => localStorage.setItem('stripex.openBoard', slug), made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap [data-kind="part"][data-ref="R1"]');
    await page.waitForTimeout(500);
    await page.locator('#boardWrap [data-kind="part"][data-ref="R1"] [data-kind="part-body"]').click({ force: true });
    await page.waitForTimeout(400);
    const choice = page.locator('[data-edit-side]');
    const n = await choice.count();
    if (!n) {
      r = { n };
    } else {
      const litBefore = await page.locator('[data-edit-side].is-on').getAttribute('data-edit-side');
      await page.locator('[data-edit-side="copper"]').click();
      await page.waitForTimeout(500);
      const g = page.locator('#boardWrap [data-kind="part"][data-ref="R1"]');
      const after = { side: await g.getAttribute('data-side'), opacity: await g.getAttribute('opacity') };
      await page.keyboard.press('Control+z');
      // Wait for the state, not a fixed time: under the full suite's load a
      // 500 ms sleep read the board before the undo had landed.
      await page.waitForFunction(() => document.querySelector('#boardWrap [data-kind="part"][data-ref="R1"]')
        ?.getAttribute('data-side') === 'top', null, { timeout: 4000 }).catch(() => {});
      const undone = await page.locator('#boardWrap [data-kind="part"][data-ref="R1"]').getAttribute('data-side');
      r = { n, litBefore, after, undone };
    }
  } finally { await context.close(); }

  eq(r.n, 2, 'a two-way Top / Copper side choice');
  if (!r.n) return;
  eq(r.litBefore, 'top', 'a resistor starts on top');
  eq(r.after.side, 'copper', 'one click puts it on the copper side');
  ok(r.after.opacity, 'and the top view ghosts it');
  eq(r.undone, 'top', 'undo puts it back');
  eq(errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
