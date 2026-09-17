// A toolbar button for a wire link, beside the pen wire.
// Governed by docs/specs/wire-link-quick-button.md
//
// Peter, 2026-09-17: "there needs to be a quick action button for Wire Link,
// next to pen link."

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('wire-link-button');

const dir = mkdtempSync(join(tmpdir(), 'stripex-linkbtn-'));
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

s.check('ONE CLICK ARMS A WIRE LINK, IT ALONE LIGHTS, AND IT PLACES ACROSS THE STRIPS', async () => {
  needBrowser();
  const made = await fetch(`${base}/api/boards`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'link-button', cols: 14, rows: 10 }),
  }).then((x) => x.json());

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  let r = {};
  try {
    await page.addInitScript((slug) => localStorage.setItem('stripex.openBoard', slug), made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(600);
    const btn = page.locator('[data-quick-part="wire-link"]');
    r.exists = await btn.count();
    if (r.exists) {
      r.afterPen = await page.evaluate(() => document.querySelector('[data-tool="wire"]')
        ?.nextElementSibling?.getAttribute('data-quick-part'));
      await btn.click();
      await page.waitForTimeout(300);
      r.lit = await btn.evaluate((b) => b.classList.contains('is-on'));
      r.placeLit = await page.locator('.tool[data-tool="place"]:not([data-quick-part])')
        .evaluate((b) => b.classList.contains('is-on'));
      r.libraryMarked = await page.locator('[data-cardbody="library"] [data-part="wire-link"].is-on').count();
      await page.locator('#boardWrap [data-kind="hole"][data-hole="4,3"]').click({ force: true });
      await page.waitForTimeout(900);
      await page.locator('[data-tool="wire"]').click();
      await page.waitForTimeout(200);
      r.unlit = !(await btn.evaluate((b) => b.classList.contains('is-on')));
    }
  } finally { await context.close(); }
  const board = await fetch(`${base}/api/boards/${made.slug}`).then((x) => x.json());
  r.placed = board.project.placements.map((p) => `${p.part}@${p.rot}`);

  ok(r.exists, 'a wire link button exists');
  if (!r.exists) return;
  eq(r.afterPen, 'wire-link', 'it sits directly after the pen wire button');
  eq(r.lit, true, 'clicking it lights it');
  eq(r.placeLit, false, 'and Place stays unlit');
  eq(r.libraryMarked, 1, 'the Library marks the wire link as chosen');
  eq(r.placed, ['wire-link@90'], 'a click on a hole places a wire link across the strips');
  eq(r.unlit, true, 'arming the pen wire unlights it');
  eq(errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
