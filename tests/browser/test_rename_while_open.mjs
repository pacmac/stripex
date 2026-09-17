// An editor with a board open follows a rename made elsewhere.
// Governed by docs/specs/rename-while-open.md

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('rename-while-open');

const dir = mkdtempSync(join(tmpdir(), 'stripex-rename-'));
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

s.check('RENAMED ELSEWHERE, THE OPEN EDITOR FOLLOWS, KEEPS SAVING, AND NOTHING COMES BACK', async () => {
  needBrowser();
  const made = await post('/api/boards', { name: 'blinker', cols: 12, rows: 8 });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  // Loads get longer: under the full suite a page load can pass 4 s.
  page.setDefaultNavigationTimeout(20000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const r = {};
  try {
    await page.addInitScript((slug) => localStorage.setItem('stripex.openBoard', slug), made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(800);

    const renamed = await post(`/api/boards/${made.slug}/rename`, { name: 'blinker v1' });
    r.to = renamed.slug;
    await page.waitForFunction((to) => localStorage.getItem('stripex.openBoard') === to, renamed.slug,
      { timeout: 3000 }).catch(() => {});
    r.remembered = await page.evaluate(() => localStorage.getItem('stripex.openBoard'));
    r.label = await page.locator('#boardLabel').innerText();

    // An edit after the rename.
    await page.locator('[data-cardbody="library"] [data-part="res-axial"]').click();
    await page.locator('#boardWrap [data-kind="hole"][data-hole="3,2"]').click({ force: true });
    for (let i = 0; i < 30; i += 1) {
      const b = await fetch(`${base}/api/boards/${renamed.slug}`).then((x) => x.json());
      r.parts = b.project?.placements?.length ?? 0;
      if (r.parts) break;
      await page.waitForTimeout(150);
    }
    r.banner = await page.evaluate(() => [...document.querySelectorAll('.banner, #banner')]
      .map((x) => x.innerText).join(' ').trim());
    await page.waitForTimeout(1500);
    const list = await fetch(`${base}/api/boards`).then((x) => x.json());
    r.slugs = list.boards.map((x) => x.slug).sort();
  } finally { await context.close(); }

  eq(r.to, 'blinker-v1', 'the rename happened');
  eq(r.remembered, 'blinker-v1', 'the editor remembers the new slug');
  eq(r.label, 'blinker v1', 'and shows the new name');
  eq(r.parts, 1, 'an edit afterwards is saved to the renamed board');
  ok(!/NOT SAVED/.test(r.banner), `with no NOT SAVED banner: "${r.banner}"`);
  eq(r.slugs, ['blinker-v1'], 'and no board comes back under the old name');
  eq(errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
