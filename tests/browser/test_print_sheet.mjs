// The Print dialog and the sheet it builds.
// Governed by docs/specs/print-sheet.md
//
// Peter, 2026-09-17: "need a print button, prefereably with options to print in
// colours and black and white, and to be able to print top and bottom on a
// single A4 sheet, either to scale or fill to contents."

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('print-sheet');

const dir = mkdtempSync(join(tmpdir(), 'stripex-print-'));
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

s.check('PRINT OPENS THE CHOICES, BUILDS A BLACK AND WHITE TWO-SIDED SHEET, AND PRINTS ONLY THE SHEET', async () => {
  needBrowser();
  const made = await post('/api/boards', { name: 'print-me', cols: 20, rows: 10 });
  // A board with a real finding on it, so "no check markers" means something.
  await post(`/api/boards/${made.slug}/ops`, { ops: [{ op: 'addPart', part: 'res-axial', at: { col: 4, row: 2 }, rot: 0 }] });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  let r = {};
  try {
    await page.addInitScript((slug) => {
      localStorage.setItem('stripex.openBoard', slug);
      window.__printed = 0;
      window.print = () => { window.__printed += 1; };
    }, made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap [data-kind="part"]');
    await page.waitForTimeout(500);

    if (!await page.locator('#print').count()) {
      r = { button: 0 };
    } else {
      await page.locator('#print').click();
      await page.waitForTimeout(300);
      r.open = await page.locator('#printDialog[open]').count();
      r.choices = await page.locator('#printDialog [data-print-colour], #printDialog [data-print-sides], #printDialog [data-print-size]').count();
      r.message = await page.locator('#printFit').innerText();
      await page.locator('[data-print-colour="mono"]').click();
      await page.locator('[data-print-sides="both"]').click();
      await page.locator('[data-print-size="fill"]').click();
      await page.locator('#printGo').click();
      await page.waitForTimeout(500);
      r.printed = await page.evaluate(() => window.__printed);
      r.sheet = await page.evaluate(() => [...document.querySelectorAll('#printSheet svg')].map((svg) => ({
        view: svg.getAttribute('data-view'),
        theme: svg.getAttribute('data-theme'),
        drc: svg.querySelectorAll('[data-kind^="drc"]').length,
      })));
      await page.emulateMedia({ media: 'print' });
      r.printVisible = await page.evaluate(() => ({
        sheet: getComputedStyle(document.querySelector('#printSheet')).display !== 'none',
        editor: getComputedStyle(document.querySelector('header.bar')).display !== 'none',
      }));
      r.button = 1;
    }
  } finally { await context.close(); }

  ok(r.button, 'there is a Print button');
  if (!r.button) return;
  eq(r.open, 1, 'it opens a dialog');
  eq(r.choices, 7, 'colour (2), sides (3) and size (2)');
  ok(/A4/.test(r.message), `the dialog states the fit on A4: "${r.message}"`);
  eq(r.printed, 1, 'Print calls the browser\'s print once');
  eq(r.sheet.map((v) => v.view), ['top', 'underside'], 'the sheet has the top and the underside');
  eq(r.sheet.map((v) => v.theme), ['mono', 'mono'], 'both in black and white');
  eq(r.sheet.reduce((a, v) => a + v.drc, 0), 0, 'with no check markers');
  eq(r.printVisible, { sheet: true, editor: false }, 'under print media only the sheet shows');
  eq(errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
