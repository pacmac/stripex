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

s.check('AND NAMES THEM, WHICH IS THE OTHER HALF OF WHAT HE ASKED FOR', async () => {
  // "the image does not show pin numbers nor names". The rebuild answered the
  // numbers and dropped the names, because at preview size the renderer's own
  // pin-name layer smeared them into DIRSTEPNC3NC4SPREADMS2. A name placed
  // OUTBOARD of the package has room, so it reads like a datasheet callout.
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(500);
    return {
      names: await page.locator('#devPreview [data-pin-name]').allInnerTexts(),
      sides: await page.locator('#devPreview [data-pin-name][data-side]').count(),
    };
  });
  eq(r.names.length, 16, 'every pad is named');
  ok(r.names.includes('DIR') && r.names.includes('VM'),
    `with the real names: ${r.names.join(' ')}`);
  eq(r.sides, 16, 'and each placed on a side of the package');
});

s.check('THE NUMBER AND THE NAME SIT INSIDE THE SILKSCREEN', async () => {
  // Peter, correcting me twice: "inside the component silk screen not outside
  // it", and then the layout itself —
  //
  //     | pin number name            name number pin |
  //
  // The bars are the package outline. From each pad you read INWARD: the number
  // first, then the name, both inside the body. That is how an IC datasheet
  // prints them, and it is what "justified towards the centre" meant.
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const box = (el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, mid: (b.left + b.right) / 2 };
      };
      const body = box(document.querySelector('#devPreview [data-kind="part-body"]'));
      const pad = (n) => box([...document.querySelectorAll('#devPreview [data-kind="pad"]')][n - 1]);
      const at = (sel) => box(document.querySelector(sel));
      return {
        body,
        pad1: pad(1),
        pad16: pad(16),
        no1: at('[data-pin-badge="1"]'),
        name1: at('[data-pin-name="1"]'),
        no16: at('[data-pin-badge="16"]'),
        name16: at('[data-pin-name="16"]'),
      };
    });
  });
  // INSIDE the outline, not beyond it.
  ok(r.no1.left >= r.body.left - 1 && r.name1.right <= r.body.right + 1,
    `pin 1's callout is within the body: ${r.no1.left} .. ${r.name1.right} in ${r.body.left}..${r.body.right}`);
  ok(r.no16.right <= r.body.right + 1 && r.name16.left >= r.body.left - 1,
    `and so is pin 16's: ${r.name16.left} .. ${r.no16.right}`);

  // Reading inward from each pad: number, then name.
  ok(r.pad1.mid < r.no1.mid && r.no1.mid < r.name1.mid,
    `left side reads pad, number, name: ${r.pad1.mid} < ${r.no1.mid} < ${r.name1.mid}`);
  ok(r.pad16.mid > r.no16.mid && r.no16.mid > r.name16.mid,
    `right side reads name, number, pad: ${r.name16.mid} < ${r.no16.mid} < ${r.pad16.mid}`);
});

s.check('THE PACKAGE SITS CENTRED ON ITS SCRAP OF BOARD', async () => {
  // The board size was guessed from span and width, so a DIP ended up two
  // strips from the left edge and hard against the right, and a single-row JST
  // sat in the left third with three dead columns beside it. Derive the size
  // from where the pins actually land and the margin is one hole all round by
  // construction.
  needBrowser();
  const { bad } = await onScreen(async (page) => {
    const out = [];
    for (const id of ['tmc2209', 'xiao', 'jst-xh-3-right', 'jst-xh-8-straight']) {
      if (!await page.locator(`#devList [data-device="${id}"]`).count()) continue;
      await page.locator(`#devList [data-device="${id}"]`).click();
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => {
        const b = (e) => e.getBoundingClientRect();
        const sub = b(document.querySelector('#devPreview [data-kind="substrate"]'));
        const pads = [...document.querySelectorAll('#devPreview [data-kind="pad"]')].map(b);
        const hole = sub.width / Math.max(1, Math.round(sub.width / (pads[0].width * 1.5)));
        return {
          l: Math.min(...pads.map((p) => p.left)) - sub.left,
          r: sub.right - Math.max(...pads.map((p) => p.right)),
          t: Math.min(...pads.map((p) => p.top)) - sub.top,
          b: sub.bottom - Math.max(...pads.map((p) => p.bottom)),
          hole,
        };
      });
      // Equal to within a third of a hole — this is centring, not a rounding rule.
      const tol = m.hole / 3;
      if (Math.abs(m.l - m.r) > tol) out.push(`${id}: left ${m.l.toFixed(0)} vs right ${m.r.toFixed(0)}`);
      if (Math.abs(m.t - m.b) > tol) out.push(`${id}: top ${m.t.toFixed(0)} vs bottom ${m.b.toFixed(0)}`);
    }
    return { bad: out };
  });
  ok(bad.length === 0, `the package is centred — ${bad.join('; ') || 'all centred'}`);
});

s.check('A NAME THAT IS ONLY THE PIN NUMBER IS NOT PRINTED TWICE', async () => {
  // A JST's pin names ARE 1, 2, 3, 4 — the connector has no function of its own
  // — so the callout read "1 1", the badge and then the same digit again.
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="jst-xh-4-right"]').click();
    await page.waitForTimeout(400);
    return page.evaluate(() => ({
      doubled: [...document.querySelectorAll('.devcallout')]
        .map((c) => [c.querySelector('.devbadge')?.textContent.trim(),
          c.querySelector('.devpinname')?.textContent.trim()])
        .filter(([n, name]) => name && name === n)
        .map(([n]) => n),
      painted: [...document.querySelectorAll('.devpinname')]
        .filter((e) => !e.textContent.trim() && e.getBoundingClientRect().width > 0).length,
    }));
  });
  ok(r.doubled.length === 0, `no callout repeats its own number: ${r.doubled.join(',') || 'none'}`);
  // And the field it would have been printed on goes with it — an empty chip is
  // a blank label painted on the silk, which reads as a leader line to nothing.
  ok(r.painted === 0, `and no empty name chip is painted: ${r.painted}`);
});

s.check('A PIN NAME READS AGAINST THE SILKSCREEN IT IS PRINTED ON', async () => {
  // The names sit on the package's own silk, with copper and holes showing
  // through behind them, and they were set in ink-dim — which on the green wash
  // is the pale smear in the screenshot. Contrast is measurable, so measure it
  // rather than calling it a matter of taste: WCAG AA for body text is 4.5:1.
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const el = document.querySelector('.devpinname');
      const silkEl = document.querySelector('#devPreview [data-kind="part-body"]');
      const fill = silkEl.getAttribute('fill') ?? getComputedStyle(silkEl).fill;
      const silk = fill.startsWith('#') ? hex(fill) : rgb(fill);
      // If the name carries its own opaque chip, that is what it is read against.
      const bgc = getComputedStyle(el).backgroundColor;
      const opaque = bgc && !/rgba\(0, 0, 0, 0\)|transparent/.test(bgc);
      const back = opaque ? rgb(bgc) : silk;
      const a = lum(rgb(getComputedStyle(el).color));
      const b = lum(back);
      return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
  });
  ok(r.ratio >= 4.5, `a pin name reads against what is behind it: ${r.ratio.toFixed(2)}:1`);
});

s.check('EVERY PAD OF EVERY DEVICE LANDS ON THE BOARD', async () => {
  // The preview is the one picture on this page a person is meant to trust, so a
  // pad drawn beyond the substrate is the same class of lie as a DIP previewed
  // along the strips: it shows a placement that cannot be built.
  //
  // A dual-row package's pin columns are `width` holes apart, so they need
  // width + 1 columns of board before any margin at all — and the preview asked
  // for width + 2, which is one short of that plus a margin either side.
  needBrowser();
  // onScreen spreads what the body returns into an object, so hand it a named
  // field rather than a bare array.
  const { bad } = await onScreen(async (page) => {
    const out = [];
    for (const id of ['tmc2209', 'xiao', 'jst-xh-3-right', 'jst-xh-8-straight']) {
      if (!await page.locator(`#devList [data-device="${id}"]`).count()) continue;
      await page.locator(`#devList [data-device="${id}"]`).click();
      await page.waitForTimeout(400);
      const off = await page.evaluate(() => {
        const b = (e) => e.getBoundingClientRect();
        const sub = b(document.querySelector('#devPreview [data-kind="substrate"]'));
        return [...document.querySelectorAll('#devPreview [data-kind="pad"]')]
          .map((p, i) => [i + 1, b(p)])
          .filter(([, r]) => r.left < sub.left - 1 || r.right > sub.right + 1
            || r.top < sub.top - 1 || r.bottom > sub.bottom + 1)
          .map(([n]) => n);
      });
      if (off.length) out.push(`${id}: pins ${off.join(',')}`);
    }
    return { bad: out };
  });
  ok(bad.length === 0, `no pad hangs off the board — ${bad.join('; ') || 'all on'}`);
});

s.check('THE DRAWING FILLS ITS PANE AND THE CALLOUTS ARE LEGIBLE', async () => {
  // Peter, looking at the screenshot: "font too small and poor alignment."
  //
  // Both come from one cause. The preview board carried a six-hole margin and
  // the SVG did not fill its pane, so most of the linear scale went on empty
  // stripboard: the package came out 5 holes wide inside a 310px drawing, which
  // leaves a 7px name and two columns that touch in the middle.
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const b = (el) => el.getBoundingClientRect();
      const pane = b(document.querySelector('#devDrawing'));
      const body = b(document.querySelector('#devPreview [data-kind="part-body"]'));
      const name = document.querySelector('[data-pin-name="1"]');
      const lefts = [...document.querySelectorAll('.devcallout[data-side="left"]')].map(b);
      const rights = [...document.querySelectorAll('.devcallout[data-side="right"]')].map(b);
      return {
        pane: { w: pane.width, h: pane.height },
        body: { w: body.width, h: body.height },
        font: parseFloat(getComputedStyle(name).fontSize),
        gap: Math.min(...rights.map((rr) => rr.left)) - Math.max(...lefts.map((l) => l.right)),
      };
    });
  });
  // The PACKAGE is the subject, not the scrap of board it is sitting on — and
  // the package's width is what decides whether two columns of names fit inside
  // it. That is the number to hold, not the substrate's.
  const used = r.body.w / r.pane.w;
  ok(used >= 0.55, `the package fills its pane: ${(used * 100).toFixed(0)}% of ${r.pane.w.toFixed(0)}px wide`);
  ok(r.font >= 12, `a pin name is readable: ${r.font}px`);
  ok(r.gap > 6, `the two callout columns do not touch: ${r.gap.toFixed(1)}px between them`);
});

s.check('PINS RUN IS ONE CHOICE ON ONE ROW, AND CHOOSING TURNS THE PREVIEW', async () => {
  // Peter: "each lib item needs to somehow identify it's pin -> strip
  // orientation." The field reused a class that a later rule turns into a
  // column, so the three options stacked full width — found in the screenshot.
  needBrowser();
  const r = await onScreen(async (page) => {
    await page.locator('#devList [data-device="tmc2209"]').click();
    await page.waitForTimeout(400);
    const buttons = page.locator('#devEdit [data-pinsrun]');
    const n = await buttons.count();
    if (!n) return { n };
    const tops = await buttons.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    const pads = async () => page.evaluate(() => [...document.querySelectorAll('#devPreview [data-kind="pad"]')]
      .slice(0, 2).map((p) => Math.round(p.getBoundingClientRect().top)));
    const before = await pads();
    await page.locator('#devEdit [data-pinsrun="along"]').click();
    await page.waitForTimeout(400);
    const lit = await page.locator('#devEdit [data-pinsrun="along"]').getAttribute('aria-pressed');
    const after = await pads();
    return { n, tops, before, after, lit };
  });
  eq(r.n, 3, 'Across, Along, Either');
  if (!r.n) return;
  eq(new Set(r.tops).size, 1, `all three on one row: tops ${r.tops}`);
  eq(r.lit, 'true', 'Along is lit once chosen');
  ok(r.before[0] !== r.before[1], `across: pins 1 and 2 on different strips (${r.before})`);
  eq(r.after[0], r.after[1], `along: pins 1 and 2 on one strip (${r.after})`);
});

s.check('A SOT-23 PREVIEWS FROM THE COPPER SIDE WITH EVERY PIN NAMED AND NO CALLOUT ON ANOTHER', async () => {
  // Found looking at the new SOT-23 MOSFET: the callouts assumed a DIP's two
  // columns, so pins 1 and 2 — side by side on one strip — grew into each
  // other and G vanished under S. And a copper-side part was drawn from the
  // top, mirrored, when the underside is the face it is built from.
  needBrowser();
  const r = await onScreen(async (page) => {
    if (!await page.locator('#devList [data-device="sot23-mosfet"]').count()) return { missing: true };
    await page.locator('#devList [data-device="sot23-mosfet"]').click();
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const view = document.querySelector('#devPreview svg')?.getAttribute('data-view');
      const names = [...document.querySelectorAll('.devpinname')]
        .filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim());
      const boxes = [...document.querySelectorAll('.devcallout')].map((e) => e.getBoundingClientRect());
      // And none lies on a PAD: a name over the pad it labels hides the thing
      // it is pointing at. Found in the screenshot after the first fix.
      const padBoxes = [...document.querySelectorAll('#devPreview [data-kind="pad"]')].map((e) => e.getBoundingClientRect());
      const onPad = boxes.filter((a) => padBoxes.some((b) => a.left < b.right - 1 && b.left < a.right - 1
        && a.top < b.bottom - 1 && b.top < a.bottom - 1)).length;
      let overlaps = 0;
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]; const b = boxes[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps += 1;
        }
      }
      return { view, names, overlaps, onPad };
    });
  });
  ok(!r.missing, 'the SOT-23 MOSFET is listed');
  if (r.missing) return;
  eq(r.view, 'underside', 'drawn from the copper side');
  eq([...r.names].sort(), ['D', 'G', 'S'], 'G, S and D are all visible');
  eq(r.overlaps, 0, 'no callout lies on another');
  eq(r.onPad, 0, 'no callout lies on a pad');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
