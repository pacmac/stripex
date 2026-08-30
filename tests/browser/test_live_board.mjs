// A board edited on disk appears in an open editor, with no reload.
// Governed by docs/specs/live-board-feed.md
//
// This is the whole of what Peter asked for: "changes that are made to the
// config file are updated immediately in the dashboard". It is also the check
// that would have caught the loop he spent this afternoon in — reloading into
// his own stale board while telling me three times the wires were not there.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('live-board');

process.env.STRIPEX_BOARDS_DIR = mkdtempSync(join(tmpdir(), 'stripex-liveui-'));

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

const api = async (path, opts) => {
  const res = await fetch(base + path, {
    headers: { 'content-type': 'application/json' }, ...opts,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

s.check('A BOARD CHANGED ON DISK APPEARS WITHOUT A RELOAD', async () => {
  needBrowser();
  const made = await api('/api/boards', {
    method: 'POST', body: JSON.stringify({ name: 'Live One', cols: 20, rows: 12 }),
  });
  eq(made.status, 201, 'created');
  const slug = made.body.slug;

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.addInitScript((sl) => {
      localStorage.clear();
      localStorage.setItem('stripex.openBoard', sl);
    }, slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(1200);
    eq(await page.locator('g[data-kind="part"]').count(), 0, 'an empty board to start');

    // Somebody else adds a part — me, at the bench, through the API.
    const cur = await api(`/api/boards/${slug}`);
    await api(`/api/boards/${slug}/ops`, {
      method: 'POST',
      body: JSON.stringify({
        version: cur.body.version,
        ops: [{ op: 'addPart', part: 'res-axial', at: { col: 3, row: 3 }, rot: 0, span: 4 }],
      }),
    });

    // NO RELOAD. The editor is told.
    await page.waitForFunction(
      () => document.querySelectorAll('g[data-kind="part"]').length === 1,
      null, { timeout: 5000 },
    );
    eq(await page.locator('g[data-kind="part"]').count(), 1, 'the part arrived on its own');
    eq(errs, [], 'and no page errors');
  } finally { await page.close(); }
});

s.check('AND SO DOES A WIRE, WHICH IS WHAT HE COULD NOT SEE', async () => {
  needBrowser();
  const made = await api('/api/boards', {
    method: 'POST', body: JSON.stringify({ name: 'Live Wire', cols: 20, rows: 12 }),
  });
  const slug = made.body.slug;
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.addInitScript((sl) => {
      localStorage.clear();
      localStorage.setItem('stripex.openBoard', sl);
    }, slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(1200);

    const cur = await api(`/api/boards/${slug}`);
    await api(`/api/boards/${slug}/ops`, {
      method: 'POST',
      body: JSON.stringify({
        version: cur.body.version,
        ops: [{ op: 'addWire', from: { col: 2, row: 2 }, to: { col: 8, row: 6 } }],
      }),
    });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-kind="wire-pad"]').length === 2,
      null, { timeout: 5000 },
    );
    eq(await page.locator('[data-kind="wire-pad"]').count(), 2, 'both pads, unprompted');
  } finally { await page.close(); }
});

s.check('THE "YOUR COPY DIFFERS" BANNER IS GONE', async () => {
  // It existed to guess what the feed now states, and it told Peter his copy
  // differed on every single load — for ever, because differing bytes was never
  // the same question as unsaved work.
  needBrowser();
  const made = await api('/api/boards', {
    method: 'POST', body: JSON.stringify({ name: 'No Banner', cols: 20, rows: 12 }),
  });
  const slug = made.body.slug;
  // The file moves on while nobody is looking.
  const cur = await api(`/api/boards/${slug}`);
  await api(`/api/boards/${slug}/ops`, {
    method: 'POST',
    body: JSON.stringify({
      version: cur.body.version,
      ops: [{ op: 'addPart', part: 'res-axial', at: { col: 3, row: 3 }, rot: 0, span: 4 }],
    }),
  });

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    // A browser holding an older copy of that board, as his was.
    await page.addInitScript((sl) => {
      localStorage.clear();
      localStorage.setItem('stripex.project', JSON.stringify({
        schema: 'stripex/1',
        name: 'No Banner',
        board: { cols: 20, rows: 12, pattern: 'strip' },
        breaks: [], placements: [], wires: [],
      }));
      localStorage.setItem('stripex.openBoard', sl);
    }, slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => ({
      parts: document.querySelectorAll('g[data-kind="part"]').length,
      banners: [...document.querySelectorAll('.banner')].map((b) => b.textContent),
    }));
    eq(seen.parts, 1, 'he is looking at the board as it is on disk');
    ok(!seen.banners.some((b) => /NOT the one on the server/i.test(b)),
      `and is asked nothing: ${JSON.stringify(seen.banners)}`);
  } finally { await page.close(); }
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
