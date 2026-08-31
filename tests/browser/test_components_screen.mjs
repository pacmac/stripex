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

// ------------------------------------------------- the datasheet rebuild
// Peter: "so many issues with that I dont know where to start ... this page
// needs sooooooo much work." What follows is his list, made checkable.

s.check('A DIP PREVIEWS THE WAY IT GOES ON STRIPBOARD', async () => {
  // The worst of them: every device was drawn at rot 0, so a DIP's pins ran
  // ALONG the strips and every pin shorted to its neighbour. The one picture on
  // the page a person is meant to trust was a picture of a mistake.
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(500);
    return {
      rows: await page.evaluate(() => new Set([...document.querySelectorAll(
        '#devPreview [data-kind="pad"]')].map((el) => el.getAttribute('cy') ?? el.getAttribute('y'))).size),
      cuts: await page.locator('#devPreview [data-kind="break"]').count(),
    };
  });
  // Pins across the strips means many distinct rows, not two.
  ok(r.rows >= 8, `its pins sit on ${r.rows} different strips, not along two`);
  ok(r.cuts >= 1, `and the cuts the package requires are drawn: ${r.cuts}`);
});

s.check('EVERY PAD CARRIES ITS NUMBER, AND PIN 1 IS MARKED', async () => {
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(500);
    return {
      badges: await page.locator('#devPreview [data-pin-badge]').count(),
      first: await page.locator('#devPreview [data-pin-badge="1"][data-first="true"]').count(),
      labels: await page.locator('#devPreview [data-pin-badge]').allInnerTexts(),
    };
  });
  eq(r.badges, 16, 'sixteen numbered pads');
  eq(r.first, 1, 'and pin 1 is the one marked first');
  ok(r.labels.includes('16'), `numbered through to the last: ${r.labels.join(',')}`);
});

s.check('SELECTING A PIN LIGHTS IT IN BOTH PLACES', async () => {
  // "I cannot select a pin and the related field is highlighted."
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(500);
    // From the table to the drawing.
    await page.locator('#devEdit [data-pin-index="4"]').focus();
    await page.waitForTimeout(200);
    const litByField = await page.locator('#devPreview [data-pin-badge="5"][data-lit="true"]').count();
    // And from the drawing to the table.
    await page.locator('#devPreview [data-pin-badge="9"]').click();
    await page.waitForTimeout(200);
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-pin-index'));
    return { litByField, focused };
  });
  eq(r.litByField, 1, 'focusing pin 5 lights pad 5');
  eq(r.focused, '8', 'and clicking pad 9 focuses the ninth name');
});

s.check('THE PIN TABLE BREAKS WHERE THE PACKAGE BREAKS', async () => {
  // A DIP runs down one side and back up the other. Eight across put pin 8 and
  // pin 9 — opposite ends of the chip — side by side.
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(500);
    return { sides: await page.locator('#devEdit [data-pin-side]').count() };
  });
  ok(r.sides >= 2, `the two sides of the package are separated: ${r.sides}`);
});

s.check('THE FIELDS ARE LABELLED THE WAY THE LIBRARY LABELS THEM', async () => {
  // The library hands over spanLabel "pins per side" and widthLabel "body width
  // in holes (3 = 0.3 in)" per part, and the first version wrote Span and Width.
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(500);
    return {
      text: await page.locator('#devEdit').innerText(),
      footprints: await page.locator('#devEdit [data-field="base"] option').allInnerTexts(),
    };
  });
  ok(/pins per side/i.test(r.text), `span is labelled as the library labels it: ${r.text.slice(0, 200)}`);
  ok(r.footprints.some((t) => /DIP \/ IC socket/.test(t)),
    `and a footprint is offered by its real name: ${r.footprints.join(' | ')}`);
});

s.check('and the catalogue can be searched', async () => {
  needBrowser();
  const r = await onScreen(async (page) => {
    const before = await page.locator('#devList [data-device]').count();
    await page.locator('#devSearch').fill('xiao');
    await page.waitForTimeout(300);
    return { before, after: await page.locator('#devList [data-device]').count() };
  });
  ok(r.before > r.after, `it filters: ${r.before} down to ${r.after}`);
  eq(r.after, 1, 'to the one that matches');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
