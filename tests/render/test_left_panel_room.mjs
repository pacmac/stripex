// The left panel must not hide parts it is holding.
// Governed by docs/specs/library-card-room.md
//
// THIS READS THE STYLESHEET, NOT THE RENDERED LAYOUT. The harness is node and
// there is no browser in it, so this can prove the rules are declared and not
// that the pixels came out right. The pixels are measured in Chromium by hand
// and reported with numbers; the missing harness is registered separately as
// `nothing-measures-the-rendered-layout`.

import { readFile } from 'node:fs/promises';
import { suite, eq, ok } from '../run.mjs';

// Comments go first, and that is not tidiness. A comment sits between the
// previous `}` and the next selector, so without this the selector reads as
// "…defeats the point of cards. */ .card-body" — and every lookup for
// `.card-body` comes back empty, which is a PASS for "there is no cap on it".
// The first draft of this check was green against the very stylesheet it was
// written to convict.
const css = (await readFile(new URL('../../public/style.css', import.meta.url), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

const s = suite('left-panel-room');

// Every declaration block whose selector list contains `sel` as a whole selector.
function blocks(sel) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selectors = m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' '));
    if (selectors.includes(sel)) out.push(m[2]);
  }
  return out;
}

// The last value declared for `prop` under `sel`, or null. Last wins, as the
// cascade says — a rule that is overridden later is not in force.
function decl(sel, prop) {
  let value = null;
  for (const body of blocks(sel)) {
    const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g');
    let m;
    while ((m = re.exec(body))) value = m[1].trim();
  }
  return value;
}

const has = (sel) => blocks(sel).length > 0;

// ------------------------------------------------ the cap that hid the parts

s.check('THE OPEN CARD IS NOT CAPPED AT A FIXED FRACTION', () => {
  // `max-height: 52vh` is a guess at how much room three closed headers need.
  // At 1000px it threw away 180px of panel and put five parts — DIP among them
  // — below the fold with nothing to say so.
  ok(has('.card-body'), 'the rule is found at all — see the comment on `css` above');
  const cap = decl('.card-body', 'max-height');
  ok(cap === null || cap === 'none', `no cap on .card-body: got ${cap}`);
});

s.check('THE LEFT PANEL IS A FLEX COLUMN', () => {
  // So the open card can be asked what room is left rather than guessing.
  eq(decl('.panel.left', 'display'), 'flex', 'display');
  eq(decl('.panel.left', 'flex-direction'), 'column', 'flex-direction');
});

s.check('the panel does not scroll — the open card does', () => {
  const o = decl('.panel.left', 'overflow') ?? decl('.panel.left', 'overflow-y');
  ok(o === 'hidden', `overflow: ${o}. Otherwise the panel scrolls and the headers leave with it`);
});

s.check('AN OPEN CARD TAKES THE REMAINING HEIGHT', () => {
  ok(has('.card.is-open'), 'there is a rule for an open card');
  const grow = decl('.card.is-open', 'flex');
  ok(grow && /^1\b/.test(grow), `it grows: flex: ${grow}`);
  eq(decl('.card.is-open', 'display'), 'flex', 'and is itself a column');
  eq(decl('.card.is-open', 'flex-direction'), 'column', 'flex-direction');
  eq(decl('.card.is-open', 'min-height'), '0', 'min-height: 0, or flex refuses to shrink it');
});

s.check('a closed card keeps its own height', () => {
  const f = decl('.card', 'flex');
  ok(f && /^0 0 auto$/.test(f), `.card { flex: ${f} } — the other headers must not stretch`);
});

s.check('THE BODY IS THE SCROLLER', () => {
  eq(decl('.card-body', 'overflow-y'), 'auto', 'it scrolls');
  eq(decl('.card-body', 'min-height'), '0', 'min-height: 0, or it never shrinks to fit');
  const f = decl('.card-body', 'flex');
  ok(f && /^1\b/.test(f), `and fills its card: flex: ${f}`);
});

// ------------------------------------------------- and it says when it clips

s.check('A CLIPPED LIST FADES AT THE EDGE THAT CONTINUES', () => {
  // THE SCROLLBAR CANNOT CARRY THIS. Measured in Chromium 150: 0px wide with
  // 386px below the fold, and still 0px under scrollbar-width: auto, under
  // thin-with-a-colour, and under ::-webkit-scrollbar { width: 8px }. This
  // build has overlay scrollbars and no CSS turns them off.
  //
  // The shadow is painted by the element itself, so it owes that policy
  // nothing. Two covers in the panel colour scroll away with the content
  // (`local`), uncovering two shades pinned to the edges (`scroll`) — so the
  // fade appears exactly when there is more past that edge.
  const img = decl('.card-body', 'background-image');
  ok(img && img.includes('var(--scroll-shade)'), `a shade is painted: ${img}`);
  const att = decl('.card-body', 'background-attachment');
  ok(att && att.includes('local') && att.includes('scroll'),
    `covers scroll with the content, shades stay: ${att}`);
});

s.check('the shade is a token, so it can invert for the dark theme', () => {
  // Black on a #1e1a13 panel is no shadow at all — there is nothing darker to go.
  ok(/--scroll-shade:/.test(css), 'the token exists');
  const light = /:root\s*\{[^}]*--scroll-shade:\s*([^;]+)/.exec(css)?.[1];
  const dark = /:root\[data-theme="dark"\]\s*\{[^}]*--scroll-shade:\s*([^;]+)/.exec(css)?.[1];
  ok(light && dark, `defined in both themes: light=${light} dark=${dark}`);
  ok(light.trim() !== dark.trim(), 'and they differ');
});

s.check('the scrollbar rules are there too, where they are honoured', () => {
  ok(has('.card-body::-webkit-scrollbar'), 'a webkit scrollbar rule exists');
  const w = decl('.card-body::-webkit-scrollbar', 'width');
  ok(w && parseFloat(w) > 0, `with a real width: ${w}`);
});

s.check('the standard property is set too', () => {
  const t = decl('.card-body', 'scrollbar-width');
  ok(t === 'thin' || t === 'auto', `scrollbar-width: ${t}`);
});

s.check('AND THE RIGHT PANEL TELLS THE TRUTH TOO', () => {
  // It scrolls the same way and would hide the end of the Nets list in exactly
  // the same silence.
  ok(has('.panel::-webkit-scrollbar'), 'the panels get a visible scrollbar as well');
  const w = decl('.panel::-webkit-scrollbar', 'width');
  ok(w && parseFloat(w) > 0, `width: ${w}`);
});

s.check('the thumb is drawn, not left transparent', () => {
  const bg = decl('.card-body::-webkit-scrollbar-thumb', 'background');
  ok(bg && bg !== 'transparent' && bg !== 'none', `a thumb you can see: ${bg}`);
});

process.exit((await s.run()) ? 0 : 1);
