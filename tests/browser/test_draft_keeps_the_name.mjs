// A draft owns what you drew. The server owns what the board is called.
// Governed by docs/specs/live-board-feed.md
//
// Peter, three times: "why have you renamed my board back again to recovered",
// and then "and YET again you have renamed my board to 'recovered'".
//
// It was never a rename. openBoard's keepDraft branch adopted the server's FRESH
// version token and then saved the browser's STALE project — so the version
// guard, the one thing that should have stopped it, could not fire. That is the
// same "fresh token, older content" mistake that lost him two spot cuts a day
// earlier, made again somewhere else.
//
// THE PRINCIPLE THAT SETTLES IT: a rename is not copper. The editor never edits
// `name` except through renameBoard, which goes straight to the server, so a
// draft's name is only ever stale and has no business overriding one.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('draft-keeps-the-name');

const dir = mkdtempSync(join(tmpdir(), 'stripex-name-'));
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

const needBrowser = () => ok(browser,
  `a browser is needed and there is none: ${importError ?? launchError}`);

const api = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* optional */ }
  return { status: res.status, body: json };
};

const boardOf = (name) => ({
  schema: 'stripex/1',
  name,
  board: { cols: 12, rows: 8, pattern: 'strip' },
  breaks: [],
  wires: [],
  placements: [{ ref: 'R1', part: 'res-axial', at: { col: 2, row: 2 }, rot: 0, span: 3 }],
  netLabels: {},
});

// Load a board in a browser that already holds `draft` and calls it unsaved.
async function loadWithDraft(slug, draft) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.addInitScript(([sl, d]) => {
      localStorage.clear();
      localStorage.setItem('stripex.project', JSON.stringify(d));
      localStorage.setItem('stripex.openBoard', sl);
      localStorage.setItem('stripex.dirty', '1');
    }, [slug, draft]);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(2200);
    return { errs, shown: await page.evaluate(() => document.querySelectorAll('g[data-kind="part"]').length) };
  } finally { await page.close(); }
}

s.check('A TAB WITH UNSAVED WORK DOES NOT REVERT THE BOARD NAME', async () => {
  needBrowser();
  const made = await api('POST', '/api/boards', { name: 'Old Name', project: boardOf('Old Name') });
  const renamed = await api('POST', `/api/boards/${made.body.slug}/rename`, { name: 'Yagi V5 Control Board' });
  eq(renamed.status, 200, 'renamed on the server');

  // The tab has an extra part and the name it cached BEFORE the rename.
  const stale = boardOf('Old Name');
  stale.placements.push({ ref: 'R2', part: 'res-axial', at: { col: 2, row: 5 }, rot: 0, span: 3 });
  const r = await loadWithDraft(renamed.body.slug, stale);

  const after = await api('GET', `/api/boards/${renamed.body.slug}`);
  eq(after.body.project.name, 'Yagi V5 Control Board',
    'the name Peter gave it is still there');
  eq(r.errs, [], 'and no page errors');
});

s.check('AND THE UNSAVED WORK IS STILL KEPT', async () => {
  // The whole reason the keepDraft branch exists. Fixing the name must not
  // bring back the data loss it was written to prevent.
  needBrowser();
  const made = await api('POST', '/api/boards', { name: 'Keep Mine', project: boardOf('Keep Mine') });
  const stale = boardOf('Keep Mine');
  stale.placements.push({ ref: 'R2', part: 'res-axial', at: { col: 2, row: 5 }, rot: 0, span: 3 });
  const r = await loadWithDraft(made.body.slug, stale);

  eq(r.shown, 2, 'both parts are on screen');
  const after = await api('GET', `/api/boards/${made.body.slug}`);
  eq(after.body.project.placements.map((p) => p.ref), ['R1', 'R2'],
    'and the unsaved part reached the server');
});

s.check('A RENAME UPDATES THE COPY IN THE BROWSER', async () => {
  // The cache went stale the instant a board was renamed, because renameBoard
  // set state.project.name and never wrote it down. That is what made every
  // later save carry the old name.
  needBrowser();
  const made = await api('POST', '/api/boards', { name: 'Before', project: boardOf('Before') });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  try {
    await page.addInitScript((sl) => {
      localStorage.clear();
      localStorage.setItem('stripex.openBoard', sl);
    }, made.body.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(1500);

    await page.locator('[data-cardtoggle="board"]').click();
    await page.waitForTimeout(300);
    const box = page.locator('[data-cardbody="board"] input').first();
    await box.fill('After');
    await box.press('Enter');
    await page.waitForTimeout(900);

    const cached = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('stripex.project') || '{}').name);
    eq(cached, 'After', 'the browser wrote the new name down');
  } finally { await page.close(); }
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
