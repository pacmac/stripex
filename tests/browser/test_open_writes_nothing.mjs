// Opening a board is not an edit.
// Governed by docs/specs/live-board-feed.md
//
// Peter, twice: "even if I make no changes and refresh the page, it seems it
// saves it overwriting any beckend changes", and then — after it had supposedly
// been fixed — "why have you renamed my board back again to recovered."
//
// It had not been fixed. connectBoards stopped ending in an unconditional
// scheduleSave(), but openBoard still called persist(), and persist() ends in
// scheduleSave() too: it sets savePending while the editor is not ready, and the
// boot flush then sends it. So a browser that merely LOOKED at a board wrote its
// own copy back over whatever the server had.
//
// That is how his Yagi V5 Control Board lost its name to a screenshot run: the
// browser had fetched the board, and something else had renamed it in between.
//
// MEASURED AT THE WIRE, not by watching the file: a request listener catches the
// PUT even when the bytes written happen to match.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('open-writes-nothing');

process.env.STRIPEX_BOARDS_DIR = mkdtempSync(join(tmpdir(), 'stripex-openw-'));

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

const PROJECT = {
  schema: 'stripex/1',
  name: 'Open Me',
  board: { cols: 14, rows: 10, pattern: 'strip' },
  breaks: [],
  wires: [],
  placements: [{ ref: 'R1', part: 'res-axial', at: { col: 3, row: 3 }, rot: 0, span: 3 }],
  netLabels: { '0,0': { name: '0V' } },
};

const made = await api('POST', '/api/boards', { name: 'Open Me', project: PROJECT });

// Open the board in a fresh browser and record every request that is not a GET.
async function writesWhileOpening(extra = null) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const writes = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url().replace(base, '')}`);
  });
  try {
    await page.addInitScript((slug) => {
      localStorage.clear();
      localStorage.setItem('stripex.openBoard', slug);
    }, made.body.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(2500);
    if (extra) await extra(page);
    await page.waitForTimeout(1500);
    return writes;
  } finally { await page.close(); }
}

s.check('the board is there to open', () => {
  eq(made.status, 201, `created: ${JSON.stringify(made.body).slice(0, 140)}`);
});

s.check('OPENING A BOARD SENDS NO WRITE AT ALL', async () => {
  needBrowser();
  const writes = await writesWhileOpening();
  eq(writes, [], `a browser that only looked at the board wrote: ${writes.join(', ')}`);
});

s.check('and the board on the server is untouched by being looked at', async () => {
  needBrowser();
  const before = await api('GET', `/api/boards/${made.body.slug}`);
  await writesWhileOpening();
  const after = await api('GET', `/api/boards/${made.body.slug}`);
  eq(after.body.version, before.body.version, 'the version is unchanged');
  eq(after.body.project.name, 'Open Me', 'and so is its name');
});

s.check('A REAL EDIT STILL SAVES', async () => {
  // The protection that matters must not be lost making opening quiet.
  needBrowser();
  const writes = await writesWhileOpening(async (page) => {
    await page.locator('.tool[data-cut="gap"]').click();
    const b = await page.locator('[data-hole="9,7"][data-kind="hole"]').first().boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  });
  ok(writes.some((w) => w.startsWith('PUT')), `an edit is saved: ${writes.join(', ') || 'nothing was sent'}`);
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
