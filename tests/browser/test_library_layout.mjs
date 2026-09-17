// The Library card: list and tiles, with a toggle in its header.
// Governed by docs/specs/library-layout.md
//
// Peter, 2026-09-17: "there is a lot of similar style text and it's impossible
// to distinguish one lib group item from another." Shown both layouts: "both
// layouts are OK, ideally there would be a little icon top right of the lib
// header that allows list to be shown as tiled or list ?"
//
// In a browser because every complaint is about what the card looks like and
// what clicking it does.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('library-layout');

const dir = mkdtempSync(join(tmpdir(), 'stripex-lib-'));
process.env.STRIPEX_BOARDS_DIR = dir;
process.env.STRIPEX_DEVICES_FILE = join(dir, 'devices.json');

const lib = await import('../../src/parts/library.js');
const WIRE_ONLY = Object.values(lib.PARTS).filter((p) => lib.isWireOnly(p)).map((p) => p.id);

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

const BODY = '[data-cardbody="library"]';
const ITEMS = `${BODY} [data-part], ${BODY} [data-device]`;

// Open the editor with the Library card open, and hand the page over. A page
// can be reused across a reload by passing keepStorage.
async function onScreen(fn, { theme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  // Loads get longer: under the full suite a page load can pass 4 s.
  page.setDefaultNavigationTimeout(20000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(600);
    // Theme lives in the More menu (toolbar-fits.md).
    if (theme === 'dark') {
      await page.locator('#more').click();
      await page.locator('#theme').click();
      await page.waitForTimeout(200);
    }
    if (!await page.locator('[data-card="library"].is-open').count()) {
      await page.locator('[data-cardtoggle="library"]').click();
    }
    await page.waitForTimeout(200);
    return { ...(await fn(page)), errs };
  } finally { await context.close(); }
}

s.check('THE HEADER CARRIES A LIST / TILES TOGGLE, AND IT IS NOT INSIDE THE HEADER BUTTON', async () => {
  needBrowser();
  const r = await onScreen(async (page) => {
    const toggle = page.locator('[data-card="library"] [data-libview-toggle]');
    const exists = await toggle.count();
    if (!exists) return { exists };
    const nested = await toggle.evaluate((el) => !!el.closest('button.card-head'));
    // At the top right: its right edge is within the header's last sixth.
    const pos = await page.evaluate(() => {
      const t = document.querySelector('[data-card="library"] [data-libview-toggle]').getBoundingClientRect();
      const h = document.querySelector('[data-card="library"] .card-head').parentElement.getBoundingClientRect();
      return { right: h.right - t.right, top: t.top - h.top, hh: h.height, hw: h.width };
    });
    const before = await page.locator(BODY).getAttribute('data-libview');
    await toggle.click();
    await page.waitForTimeout(200);
    const after = await page.locator(BODY).getAttribute('data-libview');
    // Remembered across a reload.
    await page.reload();
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(600);
    if (!await page.locator('[data-card="library"].is-open').count()) {
      await page.locator('[data-cardtoggle="library"]').click();
    }
    const reloaded = await page.locator(BODY).getAttribute('data-libview');
    return { exists, nested, pos, before, after, reloaded };
  });
  ok(r.exists, 'a view toggle exists in the Library card');
  if (!r.exists) return;
  eq(r.nested, false, 'the toggle is not nested inside the header <button>');
  ok(r.pos.right < r.pos.hw / 6 && r.pos.top < r.pos.hh, `it sits top right: ${JSON.stringify(r.pos)}`);
  eq(r.before, 'list', 'list by default');
  eq(r.after, 'tiles', 'one click gives tiles');
  eq(r.reloaded, 'tiles', 'and the choice survives a reload');
  eq(r.errs, [], 'no page errors');
});

s.check('EVERY ITEM SHOWS ITS FOOTPRINT, IN BOTH VIEWS', async () => {
  needBrowser();
  const r = await onScreen(async (page) => {
    const count = async () => page.evaluate(({ ITEMS, WIRE_ONLY }) => {
      const els = [...document.querySelectorAll(ITEMS)];
      return {
        items: els.length,
        missing: els.filter((e) => !WIRE_ONLY.includes(e.dataset.part) && !e.querySelector('svg'))
          .map((e) => e.dataset.part ?? e.dataset.device),
      };
    }, { ITEMS, WIRE_ONLY });
    const list = await count();
    const t = page.locator('[data-card="library"] [data-libview-toggle]');
    if (await t.count()) { await t.click(); await page.waitForTimeout(300); }
    const tiles = await count();
    return { list, tiles };
  });
  ok(r.list.items > 20, `the catalogue is listed: ${r.list.items}`);
  eq(r.list.missing, [], 'list: every item has a footprint');
  eq(r.tiles.missing, [], 'tiles: every item has a footprint');
});

s.check('A DEVICE AND A PART ARE LAID OUT THE SAME WAY', async () => {
  // The XIAO and the TMC2209 fell through to the default bordered, centred
  // button because the item style only named button[data-part].
  needBrowser();
  const r = await onScreen(async (page) => page.evaluate((BODY) => {
    const look = (el) => {
      const c = getComputedStyle(el);
      return { display: c.display, textAlign: c.textAlign, border: c.borderTopWidth + ' ' + c.borderTopStyle, bg: c.backgroundColor };
    };
    const part = document.querySelector(`${BODY} [data-part="res-axial"]:not(.is-on), ${BODY} [data-part="diode"]`);
    const device = document.querySelector(`${BODY} [data-device="xiao"], ${BODY} [data-device]`);
    return { part: look(part), device: look(device) };
  }, BODY));
  eq(r.device, r.part, 'same display, alignment, border and ground');
});

s.check('GROUPS HAVE A COUNT AND COLLAPSE, AND A SEARCH STILL FINDS INSIDE A COLLAPSED ONE', async () => {
  needBrowser();
  const r = await onScreen(async (page) => {
    const head = page.locator(`${BODY} [data-libgroup="connector"]`);
    if (!await head.count()) return { head: 0 };
    const count = Number(await head.getAttribute('data-count'));
    const shown = async () => page.locator(`${BODY} [data-libgroup-body="connector"] :is([data-part],[data-device])`)
      .evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).length);
    const open = await shown();
    await head.click();
    await page.waitForTimeout(200);
    const collapsed = await shown();
    await page.locator('#libsearch').fill('jst');
    await page.waitForTimeout(300);
    const searched = await shown();
    return { head: 1, count, open, collapsed, searched };
  });
  ok(r.head, 'Connectors has a group heading');
  if (!r.head) return;
  eq(r.count, r.open, `the heading's count matches its items: ${r.count}`);
  eq(r.collapsed, 0, 'a click on the heading collapses it');
  ok(r.searched > 0, `a search shows matches inside a collapsed group: ${r.searched}`);
});

s.check('IN TILES, A PART\'S SETTINGS STILL OPEN', async () => {
  needBrowser();
  const r = await onScreen(async (page) => {
    const t = page.locator('[data-card="library"] [data-libview-toggle]');
    if (await t.count()) { await t.click(); await page.waitForTimeout(200); }
    await page.locator(`${BODY} [data-part="dip"]`).click();
    await page.waitForTimeout(300);
    return { inputs: await page.locator(`${BODY} [data-param]`).count() };
  });
  ok(r.inputs > 0, `DIP chosen in tiles shows its settings: ${r.inputs} inputs`);
});

s.check('NO PAGE ERRORS IN THE DARK THEME, IN EITHER VIEW', async () => {
  needBrowser();
  const r = await onScreen(async (page) => {
    const t = page.locator('[data-card="library"] [data-libview-toggle]');
    if (await t.count()) { await t.click(); await page.waitForTimeout(300); }
    return {};
  }, { theme: 'dark' });
  eq(r.errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
