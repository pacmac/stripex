// Work in this browser is never silently replaced by an older copy.
// Governed by docs/specs/boards-on-the-server.md
//
// THIS IS THE CHECK FOR A BOARD THAT WAS ACTUALLY LOST. Peter made several
// changes, reloaded, and they were gone: his editor's saves had been refused as
// stale after the file changed underneath it, so his work was only in
// localStorage — and openBoard then installed the server's older copy over it
// and persisted that, destroying the draft.
//
// A conflict is a QUESTION. It is never resolved by throwing away the copy the
// user can see.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('draft-survives');

process.env.STRIPEX_BOARDS_DIR = mkdtempSync(join(tmpdir(), 'stripex-draft-'));

let chromium = null;
let importError = null;
try { ({ chromium } = await import('playwright')); } catch (e) { importError = e.message; }

let browser = null;
let server = null;
let base = '';
let launchError = null;

if (chromium) {
  try {
    const { app } = await import('../../src/server/index.js');
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  } catch (e) { launchError = e.message.split('\n')[0]; }
}

const needBrowser = () => ok(browser,
  `a browser is needed and there is none: ${importError ?? launchError}`);

const board = (name, parts) => ({
  schema: 'stripex/1',
  name,
  board: { cols: 25, rows: 20, pattern: 'strip' },
  breaks: [],
  wires: [],
  placements: parts.map((ref, i) => ({
    ref, part: 'res-axial', at: { col: 2, row: 2 + i * 2 }, rot: 0, span: 4,
  })),
});

async function api(path, opts) {
  const res = await fetch(base + path, {
    headers: { 'content-type': 'application/json' }, ...opts,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

s.check('A LOCAL DRAFT IS NOT REPLACED BY AN OLDER SERVER COPY', async () => {
  needBrowser();
  // A board on the server with one part.
  const made = await api('/api/boards', {
    method: 'POST', body: JSON.stringify({ name: 'Draft Test', project: board('Draft Test', ['R1']) }),
  });
  eq(made.status, 201, 'the board was created');
  const slug = made.body.slug;

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    // SEEDED BEFORE ANY LOAD. Seeding after a goto raced the editor: goto
    // resolves on the load event while connectBoards is still awaiting fetches,
    // and its persist() then overwrote the seed with the server's copy. That
    // made this check pass about half the time — and an intermittent check on a
    // data-loss defect is worse than none, because a green run means nothing.
    await page.addInitScript(([p, sl]) => {
      localStorage.clear();
      localStorage.setItem('stripex.project', JSON.stringify(p));
      localStorage.setItem('stripex.openBoard', sl);
    }, [board('Draft Test', ['R1', 'R2', 'R3']), slug]);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(1000);

    const after = await page.evaluate(() => ({
      onScreen: [...document.querySelectorAll('g[data-kind="part"]')].map((g) => g.dataset.ref),
      stored: JSON.parse(localStorage.getItem('stripex.project')).placements.map((x) => x.ref),
      banners: [...document.querySelectorAll('.banner')].map((b) => b.textContent),
    }));

    // The three parts are what the user last had. Losing R2 and R3 to a
    // one-part server copy is exactly what happened to Peter.
    eq(after.stored.length, 3, `the draft survives in this browser: ${after.stored.join(' ')}`);
    eq(after.onScreen.length, 3, `and is what is on screen: ${after.onScreen.join(' ')}`);
    // Reported, and reported as a DIFFERENCE between two places — a banner that
    // only said "conflict" would leave you guessing which copy you are looking
    // at, which is the thing that has to be unambiguous.
    ok(after.banners.some((b) => /server/i.test(b) && /browser/i.test(b)),
      `and the difference is reported, naming both copies: ${JSON.stringify(after.banners)}`);
  } finally { await page.close(); }
});

s.check('and an identical draft opens the server copy without fuss', async () => {
  needBrowser();
  const made = await api('/api/boards', {
    method: 'POST', body: JSON.stringify({ name: 'Same Test', project: board('Same Test', ['R1']) }),
  });
  const slug = made.body.slug;
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.addInitScript(([p, sl]) => {
      localStorage.clear();
      localStorage.setItem('stripex.project', JSON.stringify(p));
      localStorage.setItem('stripex.openBoard', sl);
    }, [board('Same Test', ['R1']), slug]);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(1000);
    const banners = await page.evaluate(() =>
      [...document.querySelectorAll('.banner')].map((b) => b.textContent));
    ok(!banners.some((b) => /newer|unsaved/i.test(b)),
      `nothing to warn about: ${JSON.stringify(banners)}`);
  } finally { await page.close(); }
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) server.close();
process.exit(okAll ? 0 : 1);
