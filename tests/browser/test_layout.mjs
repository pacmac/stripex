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

s.check('and the editor reaches that point without a script error', async () => {
  needBrowser();
  const r = await withPage(SIZES[0], async () => ({}));
  eq(r.errors, [], 'no page errors while booting');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) server.close();
process.exit(okAll ? 0 : 1);
