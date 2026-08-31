// The browser keeps no copy of the board.
// Governed by docs/specs/no-draft-cache.md
//
// Peter, after three reversions of his board's name: "STILL BROKEN: the draft
// cache itself - fix it".
//
// Every one of the three was the same shape — a stale copy in localStorage
// written back over the server. The cache bought the work done in the 400 ms
// between an edit and its save. A cache that is only ever read at boot is not a
// cache, it is a second source of truth.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('no-draft-cache');

const dir = mkdtempSync(join(tmpdir(), 'stripex-nocache-'));
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
  board: { cols: 14, rows: 10, pattern: 'strip' },
  breaks: [],
  wires: [],
  placements: [{ ref: 'R1', part: 'res-axial', at: { col: 2, row: 2 }, rot: 0, span: 3 }],
  netLabels: {},
});

// SEEDED ON THE SERVER, not in localStorage — which is the point of all this.
const made = await api('POST', '/api/boards', { name: 'No Cache', project: boardOf('No Cache') });

async function open(fn, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    if (opts.breakApi) {
      await page.route('**/api/**', (route) => route.abort('failed'));
    }
    await page.addInitScript((slug) => {
      localStorage.clear();
      localStorage.setItem('stripex.openBoard', slug);
    }, made.body.slug);
    await page.goto(base);
    await page.waitForTimeout(opts.breakApi ? 2500 : 0);
    if (!opts.breakApi) {
      await page.waitForSelector('#boardWrap svg');
      await page.waitForTimeout(1500);
    }
    return { ...(await fn(page)), errs };
  } finally { await page.close(); }
}

const storageOf = (page) => page.evaluate(() => ({
  keys: Object.keys(localStorage).sort(),
  project: localStorage.getItem('stripex.project'),
  dirty: localStorage.getItem('stripex.dirty'),
}));

s.check('the board is on the server to begin with', () => {
  eq(made.status, 201, `created: ${JSON.stringify(made.body).slice(0, 140)}`);
});

s.check('NO COPY OF THE BOARD IS KEPT IN THE BROWSER', async () => {
  // Inspected directly rather than inferred. It held a whole project.
  needBrowser();
  const r = await open(async (page) => ({ storage: await storageOf(page) }));
  eq(r.storage.project, null, 'stripex.project is gone');
  eq(r.storage.dirty, null, 'and so is the dirty flag');
  eq(r.errs, [], 'no page errors');
});

s.check('and not after an edit either', async () => {
  needBrowser();
  const r = await open(async (page) => {
    await page.locator('.tool[data-cut="gap"]').click();
    const b = await page.locator('[data-hole="9,7"][data-kind="hole"]').first().boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(900);
    return { storage: await storageOf(page) };
  });
  eq(r.storage.project, null, 'still no copy of the board');
  eq(r.storage.dirty, null, 'still no dirty flag');

  // And the edit reached the server, because none of this is worth losing
  // autosave over.
  const after = await api('GET', `/api/boards/${made.body.slug}`);
  ok(after.body.project.breaks.length >= 1, `the cut was saved: ${after.body.project.breaks.length}`);
});

s.check('WHAT THE BROWSER DOES KEEP IS ONLY ITS OWN', async () => {
  needBrowser();
  const r = await open(async (page) => ({ storage: await storageOf(page) }));
  ok(r.storage.keys.includes('stripex.openBoard'), `which board this tab is on: ${r.storage.keys.join(' ')}`);
  const strays = r.storage.keys.filter((k) => !['stripex.openBoard', 'stripex.layers', 'stripex.history'].includes(k));
  eq(strays, [], `and nothing else about the document: ${strays.join(' ')}`);
});

s.check('A RELOAD SHOWS WHAT THE SERVER HAS', async () => {
  // Including a change made behind the editor's back, which the cache used to
  // hide behind its own copy.
  needBrowser();
  await api('POST', `/api/boards/${made.body.slug}/ops`, {
    ops: [{ op: 'addPart', part: 'res-axial', at: { col: 2, row: 6 }, rot: 0, span: 3 }],
  });
  const r = await open(async (page) => ({
    refs: await page.locator('g[data-kind="part"]').evaluateAll((els) => els.map((e) => e.dataset.ref)),
  }));
  ok(r.refs.length >= 2, `the part added behind its back is there: ${r.refs.join(' ')}`);
});

s.check('AND THE NAME SURVIVES A RELOAD', async () => {
  // The thing that failed three times.
  needBrowser();
  await api('POST', `/api/boards/${made.body.slug}/rename`, { name: 'No Cache' });
  await open(async () => ({}));
  const after = await api('GET', `/api/boards/${made.body.slug}`);
  eq(after.body.project.name, 'No Cache', 'the board is still called what it is called');
});

s.check('AN UNREACHABLE SERVER IS SAID, NOT DRAWN OVER', async () => {
  // It used to draw from its cache and pretend. Editing into a copy that may
  // later overwrite someone else's work is how this went wrong three times.
  needBrowser();
  const r = await open(async (page) => ({
    banners: await page.locator('.banner').allInnerTexts(),
  }), { breakApi: true });
  ok(r.banners.some((b) => /server/i.test(b)),
    `it says the server is not there: ${JSON.stringify(r.banners)}`);
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
