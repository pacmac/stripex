// One board, one set of rules — whether you use HTTP or a mouse.
// Governed by docs/specs/editor-on-ops.md
//
// ops.js refuses a pen wire into an occupied hole. The editor pushed straight
// into project.wires and never asked. So the same wire was refused over HTTP and
// accepted by clicking, and the looser path is the one a person uses — which is
// how nine wire ends came to sit on top of pins on Peter's rotator board.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('editor-rules');

process.env.STRIPEX_BOARDS_DIR = mkdtempSync(join(tmpdir(), 'stripex-edrules-'));

let chromium = null;
let importError = null;
try { ({ chromium } = await import('playwright')); } catch (e) { importError = e.message; }

let browser = null;
let server = null;
let base = '';
let mod = null;
let launchError = null;
let slug = null;
let seq = 0;

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

// A board with a resistor whose pin sits at (4,2), and a ground rail on row 0.
const BOARD = {
  schema: 'stripex/1',
  name: 'Editor Rules',
  board: { cols: 16, rows: 10, pattern: 'strip' },
  breaks: [],
  wires: [],
  placements: [{ ref: 'R1', part: 'res-axial', at: { col: 4, row: 2 }, rot: 0, span: 4 }],
  netLabels: { '0,0': { name: '0V' } },
};

async function editor(fn) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    // SEEDED ON THE SERVER. The browser keeps no copy of the board any more, so
    // a test that put one in localStorage was seeding a cache that no longer
    // exists — and would have drawn an empty grid.
    const made = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `rules ${seq += 1}`, project: BOARD }),
    }).then((r) => r.json());
    slug = made.slug;
    await page.addInitScript((sl) => {
      localStorage.clear();
      localStorage.setItem('stripex.openBoard', sl);
    }, slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(900);
    return { ...(await fn(page)), errs };
  } finally { await page.close(); }
}

// Click the centre of a hole.
async function clickHole(page, col, row) {
  const b = await page.locator(`[data-hole="${col},${row}"][data-kind="hole"]`).first().boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

// ASKED OF THE SERVER, which is now the only place the board is.
const wireCount = async () => {
  const r = await fetch(`${base}/api/boards/${slug}`).then((x) => x.json());
  return r.project?.wires?.length ?? -1;
};

s.check('DRAWING A PEN WIRE ONTO A PIN IS REFUSED', async () => {
  // The exact mistake I made nine times, made with a mouse.
  needBrowser();
  const r = await editor(async (page) => {
    await page.locator('button[data-part="point-to-point"]').click();
    await clickHole(page, 12, 4);          // a free hole
    await clickHole(page, 4, 2);           // R1.1 is here
    await page.waitForTimeout(900);   // past the 400ms autosave
    return {
      wires: await wireCount(),
      status: await page.locator('#status').textContent(),
    };
  });
  eq(r.wires, 0, 'no wire was made');
  ok(/R1\.1/.test(r.status), `and it says what is in the way: ${r.status}`);
  ok(/hole to hole/i.test(r.status), `and the rule: ${r.status}`);
  eq(r.errs, [], 'with no page errors');
});

s.check('and between two free holes it still works', async () => {
  needBrowser();
  const r = await editor(async (page) => {
    await page.locator('button[data-part="point-to-point"]').click();
    await clickHole(page, 12, 4);
    await clickHole(page, 12, 6);
    await page.waitForTimeout(900);   // past the 400ms autosave
    return { wires: await wireCount(), pads: await page.locator('[data-kind="wire-pad"]').count() };
  });
  eq(r.wires, 1, 'a wire was made');
  eq(r.pads, 2, 'and drawn');
});

s.check('A PEN WIRE ONTO POWER IS ALLOWED, AND REPORTED', async () => {
  // Deliberately NOT refused with a mouse. Peter's own board carries pen wires
  // drawn before the rule existed, and a rule that makes an existing board
  // unusable is a rule nobody keeps. The API still refuses it — a planner must
  // be held to it — and the person at the bench is told and decides.
  needBrowser();
  const r = await editor(async (page) => {
    await page.locator('button[data-part="point-to-point"]').click();
    await clickHole(page, 12, 0);          // the 0V rail
    await clickHole(page, 12, 4);
    await page.waitForTimeout(900);   // past the 400ms autosave
    await page.locator('.tab[data-tab="findings"]').click();
    return {
      wires: await wireCount(),
      checks: await page.locator('#tab-findings').innerText(),
    };
  });
  eq(r.wires, 1, 'the wire was made');
  ok(/power|link/i.test(r.checks), `and Checks says so: ${r.checks.slice(0, 160)}`);
});

s.check('placing, cutting and deleting still work', async () => {
  // They go through ops.js now, so this is the check that the rewiring did not
  // break the ordinary paths.
  needBrowser();
  const r = await editor(async (page) => {
    await page.locator('button[data-part="res-axial"]').click();
    await clickHole(page, 2, 8);
    await page.waitForTimeout(800);
    const placed = (await fetch(`${base}/api/boards/${slug}`).then((r) => r.json()))
      .project.placements.length;

    await page.locator('.tool[data-cut="gap"]').click();
    await clickHole(page, 9, 5);
    await page.waitForTimeout(800);
    const cut = (await fetch(`${base}/api/boards/${slug}`).then((r) => r.json()))
      .project.breaks.length;

    // ESCAPE FIRST. Placing selects what it placed, and arming a tool acts on an
    // existing selection — verb after noun, which Peter asked for. So arming
    // Delete here with R2 still selected deletes R2, correctly, and never
    // reaches R1. Clearing the selection is what makes this a test of the click.
    await page.keyboard.press('Escape');
    await page.locator('.tool[data-tool="delete"]').click();
    const g = await page.locator('g[data-kind="part"][data-ref="R1"]').boundingBox();
    await page.mouse.click(g.x + g.width / 2, g.y + g.height / 2);
    await page.waitForTimeout(800);
    const left = (await fetch(`${base}/api/boards/${slug}`).then((r) => r.json()))
      .project.placements.map((x) => x.ref);
    return { placed, cut, left };
  });
  eq(r.placed, 2, 'a part was placed');
  ok(r.cut >= 1, `a strip was cut: ${r.cut}`);
  ok(!r.left.includes('R1'), `and R1 was deleted: ${r.left.join(' ')}`);
  ok(r.left.includes('R2'), `and only R1: ${r.left.join(' ')}`);
  eq(r.errs, [], 'no page errors through any of it');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
