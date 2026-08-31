// The component editor screen.
// Governed by docs/specs/component-editor.md
//
// Peter, 2026-08-31: "next task is a component editor screen", scoped as both,
// catalogue first. The catalogue half landed; this is the half he can see.
//
// In a browser because the complaint is that there is nothing to click: the
// devices became editable over HTTP and the only way to use that was curl.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('components-screen');

const dir = mkdtempSync(join(tmpdir(), 'stripex-compui-'));
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

// Open the editor, go to Components, and hand the page over.
async function onScreen(fn) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  // A SHORT TIMEOUT, so a red arrives in seconds. At playwright's default a
  // check for a control that does not exist yet waits thirty seconds, and eight
  // of those is a trial nobody watches to the end.
  page.setDefaultTimeout(4000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.addInitScript(() => localStorage.clear());
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(700);
    await page.locator('#components').click();
    await page.waitForSelector('#componentsScreen:not([hidden])');
    await page.waitForTimeout(500);
    return { ...(await fn(page)), errs };
  } finally { await page.close(); }
}

s.check('THE SCREEN OPENS AND LISTS EVERY DEVICE', async () => {
  needBrowser();
  const known = (await api('GET', '/api/devices')).body.devices;
  const r = await onScreen(async (page) => ({
    rows: await page.locator('#devList [data-device]').count(),
    ids: await page.locator('#devList [data-device]').evaluateAll(
      (els) => els.map((e) => e.dataset.device)),
  }));
  eq(r.rows, known.length, `one row per device: ${r.rows} vs ${known.length}`);
  ok(r.ids.includes('tmc2209'), 'the TMC2209 is there');
  ok(r.ids.includes('jst-xh-3-right'), 'and a JST');
  eq(r.errs, [], 'no page errors');
});

s.check('and choosing one shows its pins and a preview', async () => {
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(400);
    return {
      pins: await page.locator('#devEdit [data-pin-index]').count(),
      name: await page.locator('#devEdit [data-field="name"]').inputValue(),
      preview: await page.locator('#devPreview svg').count(),
    };
  });
  eq(r.pins, 16, 'sixteen pin fields');
  ok(/TMC2209/.test(r.name), `and its name: ${r.name}`);
  eq(r.preview, 1, 'with a footprint drawn');
});

s.check('AN UNVERIFIED PIN IS MARKED, BECAUSE THAT IS THE FIELD THIS GETS WRONG', async () => {
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(400);
    return { flagged: await page.locator('#devEdit [data-unverified="true"]').count() };
  });
  eq(r.flagged, 2, 'NC3 and NC4 are flagged');
});

s.check('EDITING A PIN NAME AND SAVING CHANGES THE CATALOGUE', async () => {
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(400);
    await page.locator('#devEdit [data-pin-index="2"]').fill('DIAG');
    await page.locator('#devSave').click();
    await page.waitForTimeout(600);
    return { status: await page.locator('#devStatus').textContent() };
  });
  const after = await api('GET', '/api/devices/tmc2209');
  eq(after.body.device.pins[2], 'DIAG', `saved: ${r.status}`);
  eq(after.body.builtIn, false, 'and it is no longer stock');
});

s.check('and it can be put back to stock', async () => {
  needBrowser();
  await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(400);
    await page.locator('#devRevert').click();
    await page.waitForTimeout(600);
    return {};
  });
  const after = await api('GET', '/api/devices/tmc2209');
  eq(after.body.device.pins[2], 'NC3', 'back to the built-in name');
  eq(after.body.builtIn, true, 'and marked stock');
});

s.check('AN INVALID EDIT IS REFUSED ON SCREEN AND NOT SAVED', async () => {
  needBrowser();
  const before = (await api('GET', '/api/devices/xiao')).body.device.pins[0];
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="xiao"]').click();
    await page.waitForTimeout(400);
    // Two pins with the same name: the catalogue refuses it, and the screen has
    // to say so rather than silently doing nothing.
    const second = await page.locator('#devEdit [data-pin-index="1"]').inputValue();
    await page.locator('#devEdit [data-pin-index="0"]').fill(second);
    await page.locator('#devSave').click();
    await page.waitForTimeout(600);
    return { status: await page.locator('#devStatus').textContent() };
  });
  ok(/twice|duplicate/i.test(r.status), `the reason is on screen: ${r.status}`);
  const after = (await api('GET', '/api/devices/xiao')).body.device.pins[0];
  eq(after, before, 'and nothing was stored');
});

s.check('A NEW COMPONENT CAN BE MADE AND THEN PLACED', async () => {
  // The whole point: a part that did not exist, defined by Peter, on a board.
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devNew').click();
    await page.waitForTimeout(300);
    await page.locator('#devEdit [data-field="id"]').fill('my-1206');
    await page.locator('#devEdit [data-field="name"]').fill('SMT resistor 1206');
    await page.locator('#devEdit [data-field="base"]').selectOption('smt-0603');
    await page.waitForTimeout(300);
    await page.locator('#devSave').click();
    await page.waitForTimeout(700);
    return { status: await page.locator('#devStatus').textContent() };
  });
  const made = await api('GET', '/api/devices/my-1206');
  eq(made.status, 200, `it exists: ${r.status}`);

  const board = await api('POST', '/api/boards', { name: 'ui dev', cols: 16, rows: 10 });
  const placed = await api('POST', `/api/boards/${board.body.slug}/ops`, {
    ops: [{ op: 'addPart', device: 'my-1206', at: { col: 4, row: 4 }, rot: 0 }],
  });
  eq(placed.status, 200, `and can be placed: ${JSON.stringify(placed.body).slice(0, 160)}`);
});

s.check('and the board is still there when the screen closes', async () => {
  // A screen that loses your board would be worse than no screen.
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devBack').click();
    await page.waitForTimeout(400);
    return {
      hidden: await page.locator('#componentsScreen').isHidden(),
      board: await page.locator('#boardWrap svg').count(),
    };
  });
  eq(r.hidden, true, 'the screen closes');
  eq(r.board, 1, 'and the board is drawn again');
  eq(r.errs, [], 'with no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
