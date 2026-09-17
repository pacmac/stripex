// The Print view: Top | Bot | Print, a panel in the board's place, remembered.
// Governed by docs/specs/print-view.md
//
// Peter, 2026-09-17: "rename Underside -> "Bot", add another button print ...
// the layer selection and print settings should persist so that each time I
// print I wont have to re-select everything. this panel should have a print
// button, probably top right rather than being in the header as it is now"

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('print-view');

const dir = mkdtempSync(join(tmpdir(), 'stripex-printview-'));
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

s.check('TOP | BOT | PRINT, A PANEL IN THE BOARD\'S PLACE, PRINT TOP RIGHT, TABLES, LAYERS, REMEMBERED', async () => {
  needBrowser();
  const made = await post('/api/boards', { name: 'print-view', cols: 20, rows: 10 });
  await post(`/api/boards/${made.slug}/ops`, { ops: [
    { op: 'addPart', part: 'res-axial', at: { col: 4, row: 2 }, value: '10k' },
    { op: 'addPart', part: 'res-axial', at: { col: 8, row: 2 }, value: '10k' },
  ] });

  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const r = {};
  try {
    await page.addInitScript((slug) => {
      localStorage.setItem('stripex.openBoard', slug);
      window.__printed = 0;
      window.print = () => { window.__printed += 1; };
    }, made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap [data-kind="part"]');
    await page.waitForTimeout(500);

    r.views = await page.locator('.viewbtn').allInnerTexts();
    r.headerPrint = await page.locator('header.bar #print').count();
    const printBtn = page.locator('.viewbtn[data-view="print"]');
    if (!await printBtn.count()) {
      r.noView = true;
    } else {
      await printBtn.click();
      await page.waitForTimeout(500);
      r.shown = await page.evaluate(() => ({
        panel: !document.querySelector('#printView')?.hidden,
        board: getComputedStyle(document.querySelector('#boardWrap')).display !== 'none',
      }));
      r.goTopRight = await page.evaluate(() => {
        const p = document.querySelector('#printView').getBoundingClientRect();
        const g = document.querySelector('#pvPrint').getBoundingClientRect();
        return g.right > p.left + p.width * 0.75 && g.top < p.top + p.height * 0.2;
      });

      // Choices: black and white, both, fill; BOM on; row/column labels off.
      await page.locator('#printView [data-print-colour="mono"]').click();
      await page.locator('#printView [data-print-sides="both"]').click();
      await page.locator('#printView [data-print-size="fill"]').click();
      await page.locator('#printView input[data-print-table="bom"]').check();
      await page.locator('#printView input[data-print-layer="edgeLabels"]').uncheck();
      await page.waitForTimeout(400);
      r.preview = await page.evaluate(() => ({
        views: [...document.querySelectorAll('#pvPreview svg')].map((x) => x.getAttribute('data-view')),
        theme: document.querySelector('#pvPreview svg')?.getAttribute('data-theme'),
        edgeLabels: document.querySelectorAll('#pvPreview [data-kind="edge-label"]').length,
        bomRows: [...document.querySelectorAll('#pvPreview table[data-table="bom"] tbody tr')].map((tr) => tr.innerText),
      }));

      // Remembered across a reload.
      await page.reload();
      await page.waitForSelector('#boardWrap [data-kind="part"]');
      await page.waitForTimeout(400);
      await page.locator('.viewbtn[data-view="print"]').click();
      await page.waitForTimeout(400);
      r.remembered = await page.evaluate(() => ({
        mono: document.querySelector('#printView [data-print-colour="mono"]')?.classList.contains('is-on'),
        fill: document.querySelector('#printView [data-print-size="fill"]')?.classList.contains('is-on'),
        bom: document.querySelector('#printView input[data-print-table="bom"]')?.checked,
        edgeLabels: document.querySelector('#printView input[data-print-layer="edgeLabels"]')?.checked,
      }));

      await page.locator('#pvPrint').click();
      await page.waitForTimeout(400);
      r.printed = await page.evaluate(() => window.__printed);
      r.sheetSame = await page.evaluate(() => document.querySelector('#printSheet').innerHTML
        === document.querySelector('#pvPreview .pv-sheet').innerHTML);
      await page.emulateMedia({ media: 'print' });
      r.printMedia = await page.evaluate(() => ({
        sheet: getComputedStyle(document.querySelector('#printSheet')).display !== 'none',
        editor: getComputedStyle(document.querySelector('header.bar')).display !== 'none',
      }));
      await page.emulateMedia({ media: 'screen' });
      await page.locator('.viewbtn[data-view="top"]').click();
      await page.waitForTimeout(300);
      r.back = await page.evaluate(() => ({
        panel: !document.querySelector('#printView').hidden,
        board: getComputedStyle(document.querySelector('#boardWrap')).display !== 'none',
      }));
    }
  } finally { await context.close(); }

  eq(r.views, ['Top', 'Bot', 'Print'], 'the view group reads Top, Bot, Print');
  eq(r.headerPrint, 0, 'the header has no Print button');
  ok(!r.noView, 'there is a Print view');
  if (r.noView) return;
  eq(r.shown, { panel: true, board: false }, 'Print shows the panel in place of the board');
  eq(r.goTopRight, true, 'with Print at its top right');
  eq(r.preview.views, ['top', 'underside'], 'the preview has both sides');
  eq(r.preview.theme, 'mono', 'in black and white');
  eq(r.preview.edgeLabels, 0, 'a layer switched off is off in the preview');
  ok(r.preview.bomRows.some((t) => /2/.test(t) && /R1/.test(t) && /R2/.test(t) && /10k/.test(t)),
    `a BOM row: qty 2, R1 R2, 10k — ${JSON.stringify(r.preview.bomRows)}`);
  eq(r.remembered, { mono: true, fill: true, bom: true, edgeLabels: false }, 'every choice survives a reload');
  eq(r.printed, 1, 'Print calls print once');
  eq(r.sheetSame, true, 'what prints is exactly the preview');
  eq(r.printMedia, { sheet: true, editor: false }, 'under print media only the sheet shows');
  eq(r.back, { panel: false, board: true }, 'Top brings the board back');
  eq(errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
