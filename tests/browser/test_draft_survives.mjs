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
    // WITH THE UNSAVED MARKER, because that is the scenario: his saves had been
    // refused as stale, so the work was in the browser and nowhere else. A draft
    // without that marker is a saved board and gives way — see the check below.
    await page.addInitScript(([p, sl]) => {
      localStorage.clear();
      localStorage.setItem('stripex.project', JSON.stringify(p));
      localStorage.setItem('stripex.openBoard', sl);
      localStorage.setItem('stripex.dirty', '1');
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

s.check('A RELOAD WITH NO EDITS WRITES NOTHING', async () => {
  // Peter: "even if I make no changes and refresh the page, it seems it saves it
  // overwriting any backend changes." It did. connectBoards ended with an
  // unconditional scheduleSave() in a finally, so every load pushed the
  // browser's copy up — and a change made to the file by anyone else was gone
  // the next time he refreshed. It ate a label fix of mine while I was making
  // it.
  //
  // Opening a board is not an edit. Nothing may be written until something
  // actually changes.
  needBrowser();
  const made = await api('/api/boards', {
    method: 'POST', body: JSON.stringify({ name: 'Quiet Reload', project: board('Quiet Reload', ['R1']) }),
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

    // Now somebody edits the FILE — me, at the bench, or another session.
    const cur = await api(`/api/boards/${slug}`);
    const edited = { ...cur.body.project, name: 'Quiet Reload', netLabels: { '0,0': { name: 'FROM_OUTSIDE' } } };
    const put = await api(`/api/boards/${slug}`, {
      method: 'PUT', body: JSON.stringify({ project: edited, version: cur.body.version }),
    });
    eq(put.status, 200, 'the outside edit landed');

    // And the browser is reloaded, changing nothing.
    await page.reload();
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(1500);

    const after = await api(`/api/boards/${slug}`);
    eq(after.body.project.netLabels?.['0,0']?.name, 'FROM_OUTSIDE',
      'the outside edit survived a reload that changed nothing');
  } finally { await page.close(); }
});

s.check('A BROWSER WITH NO DRAFT OPENS THE BOARD', async () => {
  // The blank board the editor starts with is NOT work. Treating it as a draft
  // worth protecting meant a clean browser — or one whose storage had been
  // cleared — refused to open the board it was told to open, showed "your copy
  // differs", and drew an empty grid. Peter could not see five wires that were
  // sitting in the file, through a hard refresh and everything.
  needBrowser();
  const made = await api('/api/boards', {
    method: 'POST',
    body: JSON.stringify({ name: 'Fresh Eyes', project: board('Fresh Eyes', ['R1', 'R2']) }),
  });
  const slug = made.body.slug;
  // Give it a wire, since wires are what he could not see.
  const cur = await api(`/api/boards/${slug}`);
  const withWire = { ...cur.body.project, wires: [{ ref: 'A', from: { col: 1, row: 1 }, to: { col: 5, row: 5 } }] };
  await api(`/api/boards/${slug}`, {
    method: 'PUT', body: JSON.stringify({ project: withWire, version: cur.body.version }),
  });

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    // Nothing stored but the bookmark — the state after clearing site data.
    await page.addInitScript((sl) => {
      localStorage.clear();
      localStorage.setItem('stripex.openBoard', sl);
    }, slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => ({
      pads: document.querySelectorAll('[data-kind="wire-pad"]').length,
      parts: document.querySelectorAll('g[data-kind="part"]').length,
      banners: [...document.querySelectorAll('.banner')].map((b) => b.textContent),
    }));
    eq(seen.pads, 2, 'the wire on the server is drawn, both pads');
    eq(seen.parts, 2, 'and its parts');
    ok(!seen.banners.some((b) => /NOT the one on the server/i.test(b)),
      `and it is not told its empty board differs: ${JSON.stringify(seen.banners)}`);
  } finally { await page.close(); }
});

s.check('A DRAFT WITH NOTHING UNSAVED IN IT GIVES WAY', async () => {
  // THE RULE IS "UNSAVED WORK", NOT "DIFFERENT BYTES".
  //
  // Peter opened a board, typed nothing, and I changed the file from outside.
  // His draft then differed from the server — of course it did — so the editor
  // kept his copy and asked him to choose. He had nothing to choose: he had made
  // no changes. Three times I told him it was fixed and three times he reloaded
  // into his own stale board, because "differs" is not the same question as "has
  // this browser got work the server has not".
  needBrowser();
  const made = await api('/api/boards', {
    method: 'POST',
    body: JSON.stringify({ name: 'Nothing Unsaved', project: board('Nothing Unsaved', ['R1']) }),
  });
  const slug = made.body.slug;

  // Somebody else adds a wire to the file — me, writing his rotator wiring.
  const cur = await api(`/api/boards/${slug}`);
  const withWire = {
    ...cur.body.project,
    wires: [{ ref: 'A', from: { col: 1, row: 1 }, to: { col: 6, row: 6 } }],
  };
  const put = await api(`/api/boards/${slug}`, {
    method: 'PUT', body: JSON.stringify({ project: withWire, version: cur.body.version }),
  });
  eq(put.status, 200, 'the outside edit landed');

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    // HIS EXACT STATE: a draft of the board as it was, no dirty flag, because he
    // has typed nothing since it last saved.
    await page.addInitScript(([p, sl]) => {
      localStorage.clear();
      localStorage.setItem('stripex.project', JSON.stringify(p));
      localStorage.setItem('stripex.openBoard', sl);
    }, [board('Nothing Unsaved', ['R1']), slug]);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(1500);

    const seen = await page.evaluate(() => ({
      pads: document.querySelectorAll('[data-kind="wire-pad"]').length,
      banners: [...document.querySelectorAll('.banner')].map((b) => b.textContent),
    }));
    eq(seen.pads, 2, 'he sees the wire, with no clicking and no banner');
    ok(!seen.banners.some((b) => /NOT the one on the server/i.test(b)),
      `and is not asked to choose: ${JSON.stringify(seen.banners)}`);
  } finally { await page.close(); }
});

s.check('but a draft with REAL unsaved work is still kept', async () => {
  // The protection that matters stays. Here the browser has an edit that never
  // reached the server, and the server has moved underneath it.
  needBrowser();
  const made = await api('/api/boards', {
    method: 'POST',
    body: JSON.stringify({ name: 'Real Work', project: board('Real Work', ['R1']) }),
  });
  const slug = made.body.slug;
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    // A draft marked as carrying unsaved work — what an edit leaves behind.
    await page.addInitScript(([p, sl]) => {
      localStorage.clear();
      localStorage.setItem('stripex.project', JSON.stringify(p));
      localStorage.setItem('stripex.openBoard', sl);
      localStorage.setItem('stripex.dirty', '1');
    }, [board('Real Work', ['R1', 'R2', 'R3']), slug]);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => ({
      parts: document.querySelectorAll('g[data-kind="part"]').length,
      banners: [...document.querySelectorAll('.banner')].map((b) => b.textContent),
    }));
    eq(seen.parts, 3, 'his three parts are what he is looking at');
    ok(seen.banners.some((b) => /server/i.test(b) && /browser/i.test(b)),
      `and he is told: ${JSON.stringify(seen.banners)}`);
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
