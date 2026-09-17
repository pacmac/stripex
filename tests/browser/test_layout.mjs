// The RENDERED layout, measured in a real browser.
//
// Every other suite runs in node against pure modules, which is why they are
// fast and why they cannot see a single one of these:
//
//   the toolbar ran off the right edge at 1280
//   the library card cut its list off at 52vh, hiding five parts
//   a rotated JST drew its shroud around one pin
//
// Three layout defects found by eye, none catchable by anything in tests/. This
// suite exists so the next one is caught by a check instead of by Peter.
//
// It boots the real server on an ephemeral port and drives the real editor. It
// is slower than the rest by two orders of magnitude and it is still under a
// couple of seconds.
//
// IF THE BROWSER IS MISSING THIS SUITE FAILS, it does not skip. A check that
// quietly skips is a check that does not exist — which is the defect this file
// was written to end.

import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('layout');

let chromium = null;
let importError = null;
try { ({ chromium } = await import('playwright')); } catch (e) { importError = e.message; }

// One browser and one server for the whole file — launching per check would
// dominate the runtime.
let browser = null;
let server = null;
let base = '';
let launchError = null;

// A TEMPORARY BOARDS DIRECTORY, set before the server module is imported.
//
// This suite drives the REAL server and the editor autosaves. Without this it
// opened Peter's live board, wrote into it, and created boards beside it — and
// then a `git checkout` to tidy up rolled his work back and invalidated his
// running editor's version, so its later saves were refused as stale. He lost
// changes to it. A suite that edits the user's data is worse than no suite.
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
process.env.STRIPEX_BOARDS_DIR = mkdtempSync(join(tmpdir(), 'stripex-test-boards-'));

if (chromium) {
  try {
    const { app } = await import('../../src/server/index.js');
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  } catch (e) {
    launchError = e.message.split('\n')[0];
  }
}

// FAIL, never skip. Every check below used to `return` early when the browser
// was missing, which made it PASS — so a machine with no browser would have
// reported "layout: 6/6 checks passed" having measured nothing at all. A
// vacuous pass is worse than a missing check, because it answers the question.
function needBrowser() {
  ok(browser, `a browser is needed and there is none: ${importError ?? launchError}. `
    + 'Run `pnpm install` then `pnpm run browsers`.');
}

s.check('THE BROWSER HARNESS IS PRESENT', () => {
  // Not skipped when absent. `pnpm install` brings playwright; the browser
  // binary comes from `pnpm exec playwright install chromium`.
  ok(!importError, `playwright imports: ${importError}`);
  ok(!launchError, `a browser launches: ${launchError}`);
});

// Open the editor at a given size, with a clean store, and hand the page over.
async function withPage(size, fn) {
  const page = await browser.newPage({ viewport: size });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  try {
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#boardWrap svg', { timeout: 5000 });
    const out = await fn(page);
    return { ...out, errors };
  } finally {
    await page.close();
  }
}

const SIZES = [
  { name: '1600x1000', width: 1600, height: 1000 },
  { name: '1280x860', width: 1280, height: 860 },
  { name: '1440x720', width: 1440, height: 720 },
];

// --------------------------------------------------------- nothing overflows

s.check('THE PAGE NEVER SCROLLS SIDEWAYS', async () => {
  // The whole editor is meant to fit its window; a horizontal scrollbar on the
  // document means something is pushing the layout wider than the screen.
  needBrowser();
  for (const size of SIZES) {
    const r = await withPage(size, (page) => page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    })));
    ok(r.scrollWidth <= r.clientWidth + 1,
      `${size.name}: ${r.scrollWidth} wide in ${r.clientWidth}`);
  }
});

s.check('AND NOTHING IS CLIPPED WITHOUT A WAY TO REACH IT', async () => {
  // The library card held 906 px of parts in 520 px with a 0 px scrollbar, so
  // five parts — DIP among them — were unreachable and unmarked. A region that
  // clips must either scroll or show a fade.
  needBrowser();
  for (const size of SIZES) {
    const r = await withPage(size, (page) => page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.card-body, .panel, .bar')) {
        const style = getComputedStyle(el);
        const clipped = el.scrollHeight > el.clientHeight + 1
          || el.scrollWidth > el.clientWidth + 1;
        if (!clipped) continue;
        const scrolls = /auto|scroll/.test(style.overflowY + style.overflowX);
        const fades = style.backgroundImage.includes('gradient');
        out.push({ cls: el.className, scrolls, fades });
      }
      return { clipped: out };
    }));
    for (const c of r.clipped) {
      ok(c.scrolls, `${size.name}: .${c.cls} clips its content but does not scroll`);
      ok(c.fades || c.scrolls, `${size.name}: .${c.cls} gives no sign it continues`);
    }
  }
});

// ------------------------------------------------------- the toolbar is whole

s.check('EVERY TOOLBAR BUTTON IS REACHABLE', async () => {
  // Not "on screen" — the bar scrolls inside itself on purpose. Reachable: it
  // is either within the bar, or the bar can be scrolled to it.
  needBrowser();
  for (const size of SIZES) {
    const r = await withPage(size, (page) => page.evaluate(() => {
      const bar = document.querySelector('.bar');
      const buttons = [...bar.querySelectorAll('button')];
      return {
        count: buttons.length,
        reachable: buttons.filter((b) => b.offsetLeft + b.offsetWidth <= bar.scrollWidth + 1).length,
        barScrolls: /auto|scroll/.test(getComputedStyle(bar).overflowX),
        overflowing: bar.scrollWidth > bar.clientWidth + 1,
      };
    }));
    ok(r.count > 8, `${size.name}: the toolbar has its buttons (${r.count})`);
    eq(r.reachable, r.count, `${size.name}: all of them are within the bar's scroll width`);
    if (r.overflowing) ok(r.barScrolls, `${size.name}: the bar overflows, so it must scroll`);
  }
});

// ------------------------------------------------- the board is actually drawn

s.check('THE BOARD IS DRAWN, AND FILLS ITS SPACE', async () => {
  needBrowser();
  for (const size of SIZES) {
    const r = await withPage(size, (page) => page.evaluate(() => {
      const svg = document.querySelector('#boardWrap svg');
      const box = svg.getBoundingClientRect();
      const wrap = document.querySelector('#boardWrap').getBoundingClientRect();
      return {
        holes: svg.querySelectorAll('[data-kind="hole"]').length,
        w: Math.round(box.width),
        h: Math.round(box.height),
        wrapW: Math.round(wrap.width),
      };
    }));
    eq(r.holes, 25 * 20, `${size.name}: every hole of a 25x20 board is drawn`);
    ok(r.w > 200 && r.h > 100, `${size.name}: the board has a size (${r.w}x${r.h})`);
    ok(r.w <= r.wrapW + 1, `${size.name}: and does not overflow its stage`);
  }
});

// ------------------------------------- the panel follows the selection
// Governed by docs/specs/nets-panel-follows-selection.md

// A board with more nets than the panel can show: 20 rows of copper is 20+ nets.
const MANY_NETS = {
  schema: 'stripex/1',
  name: 'many nets',
  board: { cols: 25, rows: 20, pattern: 'strip' },
  breaks: [],
  placements: [],
  wires: [],
};

s.check('SELECTING A STRIP BRINGS ITS NET ROW TO THE TOP', async () => {
  // The Nets tab already opens and marks the row. On Peter's own board that list
  // is 27 rows and the panel shows about eight, so the row it marks is usually
  // somewhere you cannot see: the feature works and looks like it does not.
  needBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    // SEEDED ON THE SERVER: the browser keeps no copy of the board.
    const made = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'many nets', project: MANY_NETS }),
    }).then((r) => r.json());
    await page.goto(base);
    await page.evaluate((sl) => {
      localStorage.clear();
      localStorage.setItem('stripex.openBoard', sl);
    }, made.slug);
    await page.reload();
    await page.waitForSelector('#boardWrap svg');

    // A strip near the BOTTOM of the board, so its row is far down the list —
    // and the LAST segment of that row, because the first one is under a
    // component on the board the server opens, and clicking there selects the
    // part instead. Chosen from what is actually drawn rather than assumed.
    // A point that actually HITS the copper. Holes and components are drawn over
    // the strips, so a point picked by fraction-of-width lands on a hole about
    // as often as not — which is how the first draft of this check "failed"
    // while the feature was untested.
    const hit = await page.evaluate(() => {
      const strips = [...document.querySelectorAll('[data-kind="copper"]')]
        .filter((e) => Number(e.getAttribute('data-seg').split(':')[1]) >= 14);
      for (const el of strips.reverse()) {
        const r = el.getBoundingClientRect();
        const y = r.top + r.height / 2;
        for (let x = r.right - 3; x > r.left + 3; x -= 2) {
          if (document.elementFromPoint(x, y) === el) {
            return { x, y, seg: el.getAttribute('data-seg') };
          }
        }
      }
      return null;
    });
    ok(hit, 'a strip low down the board has a clickable point');
    await page.mouse.click(hit.x, hit.y);

    const r = await page.evaluate(() => {
      const row = document.querySelector('#tab-nets .row.is-net-on');
      if (!row) return { marked: false };
      const panel = row.closest('.panel') ?? document.querySelector('.panel.right');
      return {
        marked: true,
        ref: row.querySelector('.ref')?.textContent.trim(),
        offsetFromTop: Math.round(row.getBoundingClientRect().top
          - panel.getBoundingClientRect().top),
        panelScrolls: panel.scrollHeight > panel.clientHeight + 1,
        atBottom: panel.scrollTop >= panel.scrollHeight - panel.clientHeight - 1,
        visible: row.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom + 1,
      };
    });
    ok(r.marked, 'the row is marked');
    ok(r.panelScrolls, 'the list is longer than the panel, which is the case that matters');
    // At the top — OR as near it as the list allows. The LAST net cannot reach
    // the top because there is nothing below it to push it up, and asserting a
    // fixed offset there would be asserting the impossible. Measured before the
    // fix: 2076px from the top, off screen entirely.
    ok(r.offsetFromTop < 90 || r.atBottom,
      `${r.ref} sits ${r.offsetFromTop}px from the top, and the panel `
      + `${r.atBottom ? 'is' : 'is NOT'} scrolled as far as it goes`);
    ok(r.visible, `${r.ref} is on screen`);
  } finally { await page.close(); }
});

// The temporary boards directory starts empty, so anything asserting about a
// board on the server has to put one there first. Seeded through the API, which
// is the same path the editor uses.
async function seedBoard(name = 'Bench Board') {
  const res = await fetch(`${base}/api/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.ok ? (await res.json()).slug : null;
}

s.check('THE BOARD CARD SAYS WHICH BOARD, WHILE COLLAPSED', async () => {
  // Measured: it said "25 × 20". The card is collapsed by default, so the name —
  // the whole point of the board work — was invisible until you expanded a card.
  needBrowser();
  ok(await seedBoard('Card Header Board'), 'a board exists to be named');
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(800);            // the board server answers
    const sub = (await page.locator('[data-cardsub="board"]').textContent()).trim();
    // The name comes from the board the editor actually opened, which is the
    // server's — there is no cached copy to read it from.
    const slug = await page.evaluate(() => localStorage.getItem('stripex.openBoard'));
    const name = slug
      ? (await fetch(`${base}/api/boards/${slug}`).then((r) => r.json()))?.project?.name
      : null;
    ok(sub, 'the collapsed card says something');
    ok(!/^\d+\s*×\s*\d+$/.test(sub), `it is not just the size: ${JSON.stringify(sub)}`);
    if (name) ok(sub.includes(name.slice(0, 12)), `it names the board: ${sub} vs ${name}`);
  } finally { await page.close(); }
});

s.check('and the board list separates a name from its part count', async () => {
  // Measured: "recovered 2026-08-3014 parts".
  needBrowser();
  ok(await seedBoard('List Spacing Board'), 'a board exists to be listed');
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(800);
    await page.locator('[data-cardtoggle="board"]').click();
    const gap = await page.evaluate(() => {
      const kind = document.querySelector('.board-list .kind');
      if (!kind) return null;
      return parseFloat(getComputedStyle(kind).marginLeft) || 0;
    });
    // NOT an early return when there is nothing to measure. A board is created
    // by the migration on first run, so an empty list here means something
    // upstream is broken and the check must say so rather than pass.
    ok(gap !== null, 'there is a board in the list to measure');
    ok(gap >= 4, `the count is held off the name: margin-left ${gap}px`);
  } finally { await page.close(); }
});

// ------------------------------------------------ the toolbar
// Governed by docs/specs/toolbar-icons-and-view-group.md

s.check('THE VIEW IS A BUTTON GROUP, NOT A DROPDOWN', async () => {
  // Two options behind a select costs two clicks and a menu. Two buttons cost
  // one, and show which side you are looking at without being opened.
  needBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#boardWrap svg');
    const before = await page.evaluate(() => ({
      selects: document.querySelectorAll('.bar select').length,
      views: document.querySelectorAll('.bar [data-view]').length,
      lit: [...document.querySelectorAll('.bar [data-view].is-on')].map((b) => b.dataset.view),
    }));
    eq(before.selects, 0, 'no dropdown in the toolbar');
    // Three since the Print view joined Top and Bot (print-view.md).
    eq(before.views, 3, 'three view buttons: Top, Bot, Print');
    eq(before.lit, ['top'], 'exactly one is lit, and it is Top');

    // The board actually turns over — checked by the drawing, not by a class.
    const firstHoleX = () => page.evaluate(() => {
      const h = document.querySelector('[data-kind="hole"][data-hole="0,0"]');
      return Math.round(h.getBoundingClientRect().x);
    });
    const topX = await firstHoleX();
    await page.locator('.bar [data-view="underside"]').click();
    const underX = await firstHoleX();
    const after = await page.evaluate(() => ({
      lit: [...document.querySelectorAll('.bar [data-view].is-on')].map((b) => b.dataset.view),
      view: JSON.parse(localStorage.getItem('stripex.layers') ?? '{}') && document.body ? null : null,
    }));
    eq(after.lit, ['underside'], 'the other one is lit now');
    ok(Math.abs(underX - topX) > 20,
      `hole 0,0 moved when the board turned over: ${topX} -> ${underX}`);
  } finally { await page.close(); }
});

s.check('EVERY ICON-ONLY BUTTON HAS A NAME', async () => {
  // An icon with no name is a puzzle. The tooltip is the label, and the
  // keyboard shortcut stays in it where there is one.
  needBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    const bad = await page.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll('.bar button')) {
        const words = b.textContent.replace(/\s+/g, '');
        const icon = b.querySelector('svg.ico');
        if (words.length > 2 && !icon) continue;      // a plain word button
        if (!b.title || !b.getAttribute('aria-label')) {
          out.push({ id: b.id || b.className, why: 'no name' });
          continue;
        }
        if (!icon) { out.push({ id: b.id, why: 'no drawn icon' }); continue; }
        // DRAWN, not a font glyph. Peter's complaint was that the glyphs were
        // illegible, and a glyph with no font coverage renders as a box at
        // whatever size the font picks.
        const r = icon.getBoundingClientRect();
        if (r.width < 14 || r.height < 14) {
          out.push({ id: b.id, why: `icon only ${Math.round(r.width)}x${Math.round(r.height)}` });
        }
      }
      return out;
    });
    eq(bad, [], 'every icon button has a name and a drawn icon of a usable size');
  } finally { await page.close(); }
});

s.check('A BOARD CAN BE RESIZED', async () => {
  // Peter: "I cannot resize a board." The Board card and the toolbar both used
  // id="cols", so $('#cols') always found the toolbar's — the card's input never
  // got a handler, and the toolbar's only got one after the card had been opened
  // once, bound from inside the card's painter. Two elements, one id, one
  // handler, and no combination of them that a person would find.
  needBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(700);

    const dupes = await page.evaluate(() => ({
      cols: document.querySelectorAll('[id="cols"]').length,
      rows: document.querySelectorAll('[id="rows"]').length,
    }));
    eq(dupes, { cols: 1, rows: 1 }, 'one element per id, always');

    const holes = () => page.locator('[data-kind="hole"]').count();
    eq(await holes(), 500, 'a 25x20 board to start');

    const cols = page.locator('#cols');
    await cols.fill('30');
    await cols.dispatchEvent('change');
    await page.waitForTimeout(400);
    eq(await holes(), 600, 'thirty columns of twenty holes');

    const rows = page.locator('#rows');
    await rows.fill('10');
    await rows.dispatchEvent('change');
    await page.waitForTimeout(400);
    eq(await holes(), 300, 'and ten rows of thirty');
  } finally { await page.close(); }
});

// -------------------------------------- a tool acts on what is already picked
// Governed by docs/specs/verb-after-noun.md

// Open the editor with a known board and nothing else in the way.
let seq = 0;
async function withBoard(fn, project) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    // SEEDED ON THE SERVER: the browser keeps no copy of the board, so putting
    // one in localStorage now seeds a cache that does not exist.
    const made = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `layout ${seq += 1}`, project }),
    }).then((r) => r.json());
    await page.addInitScript((sl) => {
      localStorage.clear();
      localStorage.setItem('stripex.openBoard', sl);
    }, made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(700);
    return await fn(page);
  } finally { await page.close(); }
}

const TWO_PARTS = {
  schema: 'stripex/1',
  name: 'verb after noun',
  board: { cols: 25, rows: 20, pattern: 'strip' },
  breaks: [],
  wires: [{ ref: 'A', from: { col: 14, row: 2 }, to: { col: 14, row: 8 } }],
  placements: [
    { ref: 'R1', part: 'res-axial', at: { col: 2, row: 2 }, rot: 0, span: 4 },
    { ref: 'R2', part: 'res-axial', at: { col: 2, row: 8 }, rot: 0, span: 4 },
  ],
};

s.check('A SELECTED PART IS DELETED BY THE DELETE BUTTON', async () => {
  // Peter: "sometimes I will select a component then press the move/delete etc
  // button". Rotate already worked that way, which is why the other two stood
  // out.
  needBrowser();
  const r = await withBoard(async (page) => {
    const g = await page.locator('g[data-kind="part"][data-ref="R1"]').boundingBox();
    await page.mouse.click(g.x + g.width / 2, g.y + g.height / 2);
    const selected = await page.locator('#status').textContent();
    await page.locator('.tool[data-tool="delete"]').click();
    await page.waitForTimeout(200);
    return {
      selected,
      refs: await page.evaluate(() => [...document.querySelectorAll('g[data-kind="part"]')]
        .map((el) => el.dataset.ref)),
      armed: await page.evaluate(() =>
        document.querySelector('.tool.is-on')?.dataset.tool),
      status: await page.locator('#status').textContent(),
    };
  }, TWO_PARTS);
  ok(/R1/.test(r.selected), `R1 was selected first: ${r.selected}`);
  eq(r.refs, ['R2'], 'R1 is gone and R2 is not');
  eq(r.armed, 'select', 'and the tool disarmed, as delete-disarms says');
  ok(/R1/.test(r.status), `and it said so: ${r.status}`);
});

s.check('a selected pen wire is deleted the same way', async () => {
  needBrowser();
  const r = await withBoard(async (page) => {
    const pad = await page.locator('[data-kind="wire-pad"]').first().boundingBox();
    await page.mouse.click(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.locator('.tool[data-tool="delete"]').click();
    await page.waitForTimeout(200);
    return page.evaluate(() => new Set(
      [...document.querySelectorAll('[data-kind="wire-pad"]')].map((el) => el.dataset.ref)).size);
  }, TWO_PARTS);
  eq(r, 0, 'the wire is gone');
});

s.check('A SELECTED PART IS PICKED UP BY THE MOVE BUTTON', async () => {
  // Held by pin 1: the pin every part has, marked square on the board, and the
  // one a person points at when they say "this part".
  needBrowser();
  const r = await withBoard(async (page) => {
    const g = await page.locator('g[data-kind="part"][data-ref="R1"]').boundingBox();
    await page.mouse.click(g.x + g.width / 2, g.y + g.height / 2);
    await page.locator('.tool[data-tool="move"]').click();
    await page.waitForTimeout(200);
    return {
      handle: await page.locator('[data-kind="move-anchor"]').count(),
      ref: await page.evaluate(() =>
        document.querySelector('[data-kind="move-anchor"]')?.dataset.ref),
      status: await page.locator('#status').textContent(),
    };
  }, TWO_PARTS);
  eq(r.handle, 1, 'the move handle is on the board');
  eq(r.ref, 'R1', 'holding R1');
  ok(/R1/.test(r.status), `and it says so: ${r.status}`);
});

s.check('a selected NET is not deleted by the delete button', async () => {
  // A net is not an object you can delete. Selecting a strip and pressing
  // Delete must not do something surprising to the copper.
  needBrowser();
  const r = await withBoard(async (page) => {
    const hit = await page.evaluate(() => {
      const el = document.querySelector('[data-kind="copper"][data-seg="s:15:0"]');
      const b = el.getBoundingClientRect();
      const y = b.top + b.height / 2;
      for (let x = b.right - 3; x > b.left + 3; x -= 2) {
        if (document.elementFromPoint(x, y) === el) return { x, y };
      }
      return null;
    });
    await page.mouse.click(hit.x, hit.y);
    await page.locator('.tool[data-tool="delete"]').click();
    await page.waitForTimeout(200);
    return page.evaluate(() => ({
      parts: document.querySelectorAll('g[data-kind="part"]').length,
      breaks: document.querySelectorAll('[data-kind="break"]').length,
      armed: document.querySelector('.tool.is-on')?.dataset.tool,
    }));
  }, TWO_PARTS);
  eq(r.parts, 2, 'both parts still there');
  eq(r.breaks, 0, 'and no copper was cut or restored');
  eq(r.armed, 'delete', 'the tool simply armed');
});

s.check('and with nothing selected the tool just arms', async () => {
  needBrowser();
  const r = await withBoard(async (page) => {
    await page.keyboard.press('Escape');
    await page.locator('.tool[data-tool="delete"]').click();
    await page.waitForTimeout(200);
    return page.evaluate(() => ({
      parts: document.querySelectorAll('g[data-kind="part"]').length,
      armed: document.querySelector('.tool.is-on')?.dataset.tool,
    }));
  }, TWO_PARTS);
  eq(r, { parts: 2, armed: 'delete' }, 'nothing deleted, tool armed');
});

s.check('and the old way still works', async () => {
  needBrowser();
  const r = await withBoard(async (page) => {
    await page.locator('.tool[data-tool="delete"]').click();
    const g = await page.locator('g[data-kind="part"][data-ref="R2"]').boundingBox();
    await page.mouse.click(g.x + g.width / 2, g.y + g.height / 2);
    await page.waitForTimeout(200);
    return page.evaluate(() => [...document.querySelectorAll('g[data-kind="part"]')]
      .map((el) => el.dataset.ref));
  }, TWO_PARTS);
  eq(r, ['R1'], 'arm then click still deletes');
});

s.check('and the editor reaches that point without a script error', async () => {
  needBrowser();
  const r = await withPage(SIZES[0], async () => ({}));
  eq(r.errors, [], 'no page errors while booting');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) server.close();
process.exit(okAll ? 0 : 1);
