// An edit made while a save is in flight still reaches the server.
// Governed by docs/specs/edit-during-save.md

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('edit-during-save');

const dir = mkdtempSync(join(tmpdir(), 'stripex-midsave-'));
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

s.check('WITH A SLOW SAVE, AN EDIT MADE DURING IT STILL REACHES THE SERVER', async () => {
  needBrowser();
  const made = await post('/api/boards', { name: 'midsave', cols: 14, rows: 10 });
  await post(`/api/boards/${made.slug}/ops`, { ops: [{ op: 'addPart', part: 'res-axial', at: { col: 4, row: 2 } }] });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(20000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  let r1 = null;
  try {
    await page.addInitScript((slug) => localStorage.setItem('stripex.openBoard', slug), made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap [data-kind="part"][data-ref="R1"]');
    await page.waitForTimeout(600);
    await page.route('**/api/boards/*', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      const res = await route.fetch();
      await new Promise((ok_) => setTimeout(ok_, 2000));
      return route.fulfill({ response: res });
    });
    await page.locator('#boardWrap [data-kind="part"][data-ref="R1"] [data-kind="part-body"]').click({ force: true });
    await page.locator('.tab[data-tab="inspect"]').click();
    await page.locator('[data-edit-side="copper"]').click();
    await page.waitForTimeout(900);              // the first save is now in flight
    await page.locator('[data-edit="value"]').fill('10k');
    await page.locator('[data-edit="value"]').press('Tab');
    for (let i = 0; i < 40; i += 1) {
      const p = (await fetch(`${base}/api/boards/${made.slug}`).then((x) => x.json())).project;
      r1 = p.placements.find((x) => x.ref === 'R1');
      if (r1?.value === '10k') break;
      await page.waitForTimeout(200);
    }
  } finally { await context.close(); }

  eq(r1?.side, 'copper', 'the first edit was saved');
  eq(r1?.value, '10k', 'and so was the edit made while it was saving');
  eq(errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
