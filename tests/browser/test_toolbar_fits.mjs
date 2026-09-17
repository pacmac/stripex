// The toolbar fits at the widths it is used at.
// Governed by docs/specs/toolbar-fits.md

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('toolbar-fits');

const dir = mkdtempSync(join(tmpdir(), 'stripex-bar-'));
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

const needBrowser = () => ok(browser, `a browser is needed and there is none: ${importError ?? launchError}`);
const LONG = 'yagi v5 control board copy';

async function at(width, fn) {
  const made = await fetch(`${base}/api/boards`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `${LONG} ${width}`, cols: 12, rows: 8 }),
  }).then((x) => x.json());
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.addInitScript((slug) => localStorage.setItem('stripex.openBoard', slug), made.slug);
    await page.goto(base);
    await page.waitForSelector('#boardWrap svg');
    await page.waitForTimeout(500);
    return { ...(await fn(page)), errs };
  } finally { await context.close(); }
}

const hiddenButtons = (page) => page.evaluate(() => {
  const bar = document.querySelector('header.bar');
  const edge = bar.getBoundingClientRect().right;
  return [...bar.querySelectorAll('button')]
    .filter((b) => b.getClientRects().length && !b.closest('#moreMenu'))
    .filter((b) => b.getBoundingClientRect().right > edge + 0.5)
    .map((b) => b.id || b.getAttribute('aria-label') || b.textContent.trim());
});

for (const width of [1440, 1600]) {
  s.check(`AT ${width}px NOTHING IN THE TOOLBAR IS OUT OF SIGHT, WITH A LONG BOARD NAME`, async () => {
    needBrowser();
    const r = await at(width, async (page) => ({ hidden: await hiddenButtons(page) }));
    eq(r.hidden, [], `no button past the bar's edge at ${width}`);
    eq(r.errs, [], 'no page errors');
  });
}

s.check('THE MORE MENU HOLDS THEME AND THE FILE ACTIONS, AND THEY STILL WORK', async () => {
  needBrowser();
  const r = await at(1440, async (page) => {
    const more = page.locator('#more');
    if (!await more.count()) return { more: 0 };
    await more.click();
    await page.waitForTimeout(200);
    const open = await page.locator('#moreMenu').isVisible();
    const items = await page.locator('#moreMenu button').evaluateAll((els) => els.map((e) => e.id));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const closedByEscape = !(await page.locator('#moreMenu').isVisible());
    const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme ?? 'light');
    await more.click();
    await page.locator('#moreMenu #theme').click();
    await page.waitForTimeout(250);
    const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme ?? 'light');
    const closedByChoice = !(await page.locator('#moreMenu').isVisible());
    const tooltip = await page.locator('#boards').getAttribute('title');
    return { more: 1, open, items, closedByEscape, themeBefore, themeAfter, closedByChoice, tooltip };
  });
  ok(r.more, 'there is a More button');
  if (!r.more) return;
  eq(r.open, true, 'it opens a menu');
  eq(r.items, ['theme', 'save', 'load', 'restore', 'export'], 'Theme, Download, Open, Restore, Export');
  eq(r.closedByEscape, true, 'Escape closes it');
  ok(r.themeAfter !== r.themeBefore, `choosing Theme switches the theme: ${r.themeBefore} -> ${r.themeAfter}`);
  eq(r.closedByChoice, true, 'and closes the menu');
  ok(String(r.tooltip).includes(LONG), `the board's full name is its tooltip: ${r.tooltip}`);
  eq(r.errs, [], 'no page errors');
});

const okAll = await s.run();
if (browser) await browser.close();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
