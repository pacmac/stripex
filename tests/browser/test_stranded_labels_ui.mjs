// A name that can no longer be seen can still be found and cleared.
// Governed by docs/specs/stranded-net-labels.md
//
// Peter's MS1 at (8,17) on the Yagi board: stored, spot-faced, and unreachable.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('stranded-labels-ui');

const dir = mkdtempSync(join(tmpdir(), 'stripex-stranded-'));
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

s.check('THE NETS TAB LISTS A NAME ON NO NET, AND CLEAR REMOVES IT FROM THE BOARD', async () => {
  needBrowser();
  const project = {
    schema: 'stripex/1', name: 'stranded', board: { cols: 12, rows: 6, pattern: 'strip' },
    placements: [{ ref: 'R1', part: 'res-axial', span: 4, at: { col: 3, row: 1 }, rot: 90 }],
    breaks: [{ row: 1, x: 6, at: 'hole' }],
    wires: [],
    netLabels: { '6,1': { name: 'MS1' } },
  };
  const made = await fetch(`${base}/api/boards`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'stranded', project }),
  }).then((x) => x.json());
  ok(made.slug, `made the board: ${made.error ?? ''}`);

  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  // Loads get longer: under the full suite a page load can pass 4 s.
  page.setDefaultNavigationTimeout(20000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  let r = {};
  try {
    await page.addInitScript((slug) => localStorage.setItem('stripex.openBoard', slug), made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(500);
    await page.locator('.tab[data-tab="nets"]').click();
    await page.waitForTimeout(300);
    const row = page.locator('#tab-nets [data-stranded="6,1"]');
    r.listed = await row.count();
    if (r.listed) {
      r.text = await row.innerText();
      await page.locator('#tab-nets [data-clear-label="6,1"]').click();
      // Wait for the save to reach the server rather than sleeping.
      for (let i = 0; i < 30; i += 1) {
        const b = await fetch(`${base}/api/boards/${made.slug}`).then((x) => x.json());
        r.stored = b.project.netLabels?.['6,1'];
        if (!r.stored) break;
        await page.waitForTimeout(150);
      }
      r.stillListed = await page.locator('#tab-nets [data-stranded="6,1"]').count();
    }
  } finally { await context.close(); }

  eq(r.listed, 1, 'the stranded name is listed in the Nets tab');
  if (!r.listed) return;
  ok(/MS1/.test(r.text) && /B7/.test(r.text), `with its name and hole: "${r.text}"`);
  eq(r.stored, undefined, 'Clear removes it from the stored board');
  eq(r.stillListed, 0, 'and from the list');
  eq(errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
