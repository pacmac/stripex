// The rules can be changed by the person they constrain.
// Governed by docs/specs/rules-are-configurable.md
//
// In a browser because the complaint is about a control that did not exist:
// "this list will grow so it needs to be configurable" was answered with a rule
// set a program could override and a person could not reach.
//
// THE LOAD-BEARING CHECK is that the card has a row per RULE_DEFS entry without
// app.js naming a single rule. Anything else is three checkboxes typed by hand,
// which is a second list of rules that will disagree with the first.

import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok, softImport } from '../run.mjs';

const s = suite('rules-card');

process.env.STRIPEX_BOARDS_DIR = mkdtempSync(join(tmpdir(), 'stripex-rules-'));

const R = await softImport('../../src/model/rules.js', import.meta.url);

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

const BOARD = {
  schema: 'stripex/1',
  name: 'Rules Card',
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
    await page.addInitScript((p) => {
      localStorage.clear();
      localStorage.setItem('stripex.project', JSON.stringify(p));
    }, BOARD);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(900);
    await page.locator('[data-cardtoggle="rules"]').click();
    await page.waitForTimeout(200);
    return { ...(await fn(page)), errs };
  } finally { await page.close(); }
}

const stored = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('stripex.project')).rules ?? null);

s.check('THE CARD HAS A ROW PER RULE, AND app.js NAMES NONE OF THEM', () => {
  // The source half, which is the half that keeps them from drifting. If a rule
  // id appears in app.js, someone has typed a control by hand and the next rule
  // will need the same.
  const src = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const named = R.RULE_DEFS.map((d) => d.id)
    .filter((id) => new RegExp(`['"\`]${id.replace('.', '\\.')}['"\`]`).test(src));
  eq(named, [], `app.js names rules of its own: ${named.join(', ')}`);
});

s.check('and it draws one control for each', async () => {
  needBrowser();
  const r = await editor(async (page) => ({
    rows: await page.locator('[data-cardbody="rules"] [data-rule]').count(),
    labels: await page.locator('[data-cardbody="rules"] .rule-label').allInnerTexts(),
  }));
  eq(r.rows, R.RULE_DEFS.length, 'a control per definition');
  for (const def of R.RULE_DEFS) {
    ok(r.labels.some((l) => l.includes(def.label)), `${def.id} is labelled: ${def.label}`);
  }
  eq(r.errs, [], 'no page errors');
});

s.check('SWITCHING A RULE OFF IS SAVED AND REPORTED', async () => {
  needBrowser();
  const r = await editor(async (page) => {
    await page.locator('[data-rule="penWiresFreeHolesOnly"]').uncheck();
    await page.waitForTimeout(400);
    const saved = await stored(page);
    await page.locator('.tab[data-tab="findings"]').click();
    return { saved, checks: await page.locator('#tab-findings').innerText() };
  });
  eq(r.saved?.penWiresFreeHolesOnly, false, 'the board carries the change');
  ok(/switched off|hole to hole/i.test(r.checks), `and Checks says so: ${r.checks.slice(0, 200)}`);
});

s.check('and with it off, a pen wire may land on a pin', async () => {
  // The rule is data all the way down: the same click, refused under the default
  // and allowed once the board says otherwise.
  needBrowser();
  const r = await editor(async (page) => {
    await page.locator('[data-rule="penWiresFreeHolesOnly"]').uncheck();
    await page.waitForTimeout(300);
    // The Rules card is open, so the palette is collapsed. Open it again — the
    // cards are one at a time by design.
    await page.locator('[data-cardtoggle="library"]').click();
    await page.waitForTimeout(200);
    await page.locator('button[data-part="point-to-point"]').click();
    const hole = async (c, rw) => {
      const b = await page.locator(`[data-hole="${c},${rw}"][data-kind="hole"]`).first().boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    };
    await hole(12, 4);
    await hole(4, 2);              // R1.1 is here
    await page.waitForTimeout(300);
    return { wires: await page.evaluate(() =>
      JSON.parse(localStorage.getItem('stripex.project')).wires.length) };
  });
  eq(r.wires, 1, 'the wire was made');
});

s.check('a bad pattern is refused and says which', async () => {
  needBrowser();
  const r = await editor(async (page) => {
    const box = page.locator('textarea[data-rule="netClasses.power"]');
    await box.fill('^0V$\n^(unclosed');
    await box.blur();
    await page.waitForTimeout(300);
    return { saved: await stored(page), status: await page.locator('#status').textContent() };
  });
  ok(/unclosed/.test(r.status), `the status names the pattern: ${r.status}`);
  ok(!r.saved?.netClasses, 'and nothing was stored');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
