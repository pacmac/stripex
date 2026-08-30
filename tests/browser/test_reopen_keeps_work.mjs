// Reopening a board keeps your work and says so quietly.
// Governed by docs/specs/live-board-feed.md
//
// Peter, 2026-08-30: "get rid of this: The copy of this board in your browser is
// NOT the one on the server, and yours is what you are looking at. Nothing has
// been overwritten. Make any edit to save yours over the server's, or open the
// board again from the Board card to take the server's and lose yours."
//
// Four sentences of interrogation on a page load, and the last survivor of the
// draft-reconciliation system he had already called convoluted and confusing
// when he asked for the live feed. It asks a question the version guard can
// answer: the browser's work goes to the server, and if the server has moved on
// the write is REFUSED rather than silently winning.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('reopen-keeps-work');

process.env.STRIPEX_BOARDS_DIR = mkdtempSync(join(tmpdir(), 'stripex-reopen-'));

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

const SERVER_COPY = {
  schema: 'stripex/1',
  name: 'reopen',
  board: { cols: 16, rows: 10, pattern: 'strip' },
  breaks: [],
  wires: [],
  placements: [{ ref: 'R1', part: 'res-axial', at: { col: 2, row: 2 }, rot: 0, span: 4 }],
  netLabels: {},
};

// The browser's copy: the server's, plus a part it has never been told about.
const DRAFT = {
  ...SERVER_COPY,
  placements: [
    ...SERVER_COPY.placements,
    { ref: 'R2', part: 'res-axial', at: { col: 2, row: 6 }, rot: 0, span: 4 },
  ],
};

await api('POST', '/api/boards', { name: 'reopen', project: SERVER_COPY });

s.check('A RELOAD WITH UNSAVED WORK RAISES NO BANNER', async () => {
  needBrowser();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    // What a reload looks like: the board is open, the draft is dirty, and the
    // server's copy is older.
    await page.addInitScript((d) => {
      localStorage.clear();
      localStorage.setItem('stripex.project', JSON.stringify(d));
      localStorage.setItem('stripex.openBoard', 'reopen');
      localStorage.setItem('stripex.dirty', '1');
    }, DRAFT);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(1500);

    const banners = await page.locator('.banner').allInnerTexts();
    const shouty = banners.filter((b) => /NOT the one on the server|lose yours/i.test(b));
    eq(shouty, [], `no interrogation: ${JSON.stringify(banners)}`);

    // AND THE WORK IS STILL THERE. Removing the banner by throwing the draft
    // away would be the data-loss bug this whole path exists to prevent.
    const refs = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('stripex.project')).placements.map((x) => x.ref));
    ok(refs.includes('R2'), `the unsaved part survived: ${refs.join(' ')}`);
    eq(errs, [], 'no page errors');
  } finally { await page.close(); }
});

s.check('AND IT REACHES THE SERVER WITHOUT BEING ASKED', async () => {
  // "Make any edit to save yours" was asking the user to do by hand what the
  // program can do: the draft is the newer thing, so it is written.
  const after = await api('GET', '/api/boards/reopen');
  const refs = (after.body?.project?.placements ?? []).map((x) => x.ref);
  ok(refs.includes('R2'), `the server has it now: ${refs.join(' ')}`);
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
