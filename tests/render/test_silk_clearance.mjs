// Silkscreen is clipped back from pads.
// Governed by docs/specs/silk-cleared-from-pads.md
//
// Peter, 2026-08-31: "is it possible for the silk screen outline not to cut
// through the device's own pads as it is confusing" — and on confirming what was
// meant: "break the outline where it crosses a pad - yes."
//
// Measured before this: on a right-angle JST the distance from every pad centre
// to the nearest edge of its own body outline was 0.00 mm. The line bisected all
// three pads. It followed directly from putting the pins in line with the
// shroud's edge, which is where they really are — so correcting a footprint to
// the truth makes this MORE likely, not less.
//
// It is also what a fabricator does: silk is clipped back from every pad,
// because ink on a pad spoils the joint. The drawing convention is the
// manufacturing rule.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const D = await softImport('../../src/parts/devices.js', here);
const lib = await softImport('../../src/parts/library.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const G = await softImport('../../src/model/geometry.js', here);

const s = suite('silk-clearance');

const PAD_R = G.PITCH_MM * 0.34;

function render(placements, cols = 24, rows = 16) {
  const p = boardm.makeProject({ cols, rows });
  for (const pl of placements) p.placements.push(pl);
  return R.renderBoard(p, {});
}

// The pad centres the renderer actually drew, from the pad elements themselves.
const padCentres = (svg) => [
  ...[...svg.matchAll(/<circle data-kind="pad"[^>]*cx="(-?[0-9.]+)" cy="(-?[0-9.]+)" r="([0-9.]+)"/g)]
    .map((m) => ({ x: +m[1], y: +m[2] })),
  ...[...svg.matchAll(/<rect data-kind="pad"[^>]*x="(-?[0-9.]+)" y="(-?[0-9.]+)" width="([0-9.]+)"/g)]
    .map((m) => ({ x: +m[1] + +m[3] / 2, y: +m[2] + +m[3] / 2 })),
];

// Every hole punched in a mask, as centres with a radius.
const maskHoles = (svg) => {
  const out = [];
  for (const m of svg.matchAll(/<mask id="([^"]+)"[^>]*>([\s\S]*?)<\/mask>/g)) {
    for (const c of m[2].matchAll(/<circle[^>]*cx="(-?[0-9.]+)" cy="(-?[0-9.]+)" r="([0-9.]+)"/g)) {
      out.push({ mask: m[1], x: +c[1], y: +c[2], r: +c[3] });
    }
  }
  return out;
};

// ------------------------------------------------- the part that was wrong

s.check('A BODY IS DRAWN THROUGH A MASK', () => {
  // The right-angle JST: the part where the outline bisected all three pads.
  const svg = render([D.placementFor('jst-xh-3-right', { col: 4, row: 5 }, 0, 'J1')]);
  ok(/<mask id="[^"]+"/.test(svg), 'a mask is defined');
  ok(/<g[^>]*mask="url\(#[^"]+\)"/.test(svg), `and something is drawn through it: ${svg.slice(0, 60)}`);
});

s.check('WITH A HOLE AT EVERY ONE OF ITS OWN PADS', () => {
  const svg = render([D.placementFor('jst-xh-3-right', { col: 4, row: 5 }, 0, 'J1')]);
  const pads = padCentres(svg);
  const holes = maskHoles(svg);
  eq(pads.length, 3, 'the connector drew three pads');
  for (const pad of pads) {
    const hit = holes.find((h) => Math.abs(h.x - pad.x) < 0.01 && Math.abs(h.y - pad.y) < 0.01);
    ok(hit, `the pad at ${pad.x.toFixed(2)},${pad.y.toFixed(2)} is cleared: `
      + `${JSON.stringify(holes.map((h) => `${h.x.toFixed(2)},${h.y.toFixed(2)}`))}`);
    ok(hit && hit.r > PAD_R, `and with clearance: hole r=${hit?.r.toFixed(2)} vs pad r=${PAD_R.toFixed(2)}`);
  }
});

s.check('and a DIP clears all of its pads too', () => {
  const svg = render([{ ref: 'U1', part: 'dip', at: { col: 4, row: 4 }, rot: 0, span: 4, width: 3 }]);
  const pads = padCentres(svg);
  const holes = maskHoles(svg);
  eq(pads.length, 8, 'eight pads');
  const missed = pads.filter((p) => !holes.some((h) => Math.abs(h.x - p.x) < 0.01 && Math.abs(h.y - p.y) < 0.01));
  eq(missed, [], `every pad is cleared: ${missed.length} were not`);
});

// ------------------------------------------------- it must not overreach

s.check('TWO PARTS DO NOT SHARE A MASK', () => {
  // One mask per placement, or a connector would punch holes in its neighbour.
  const svg = render([
    D.placementFor('jst-xh-3-right', { col: 2, row: 3 }, 0, 'J1'),
    D.placementFor('jst-xh-3-right', { col: 12, row: 9 }, 0, 'J2'),
  ]);
  const ids = [...new Set(maskHoles(svg).map((h) => h.mask))];
  eq(ids.length, 2, `two masks: ${ids.join(' ')}`);
  for (const id of ids) {
    eq(maskHoles(svg).filter((h) => h.mask === id).length, 3, `${id} clears only its own three pads`);
  }
});

s.check('AND THE PADS THEMSELVES ARE NOT MASKED', () => {
  // They are the thing being made legible. Clearing them away would be worse
  // than the outline crossing them.
  const svg = render([D.placementFor('jst-xh-3-right', { col: 4, row: 5 }, 0, 'J1')]);
  eq(padCentres(svg).length, 3, 'the pads are still drawn');
  ok(/data-kind="pad"[^>]*data-pin="1"/.test(svg), 'and still carry what the editor hit-tests on');

  // The pad elements must sit outside the masked wrapper.
  const wrapper = /<g[^>]*mask="url\(#[^"]+\)"[^>]*>([\s\S]*?)<\/g>\s*(?=<(?:rect|circle) data-kind="pad")/;
  const inside = wrapper.exec(svg)?.[1] ?? '';
  ok(!/data-kind="pad"/.test(inside), 'no pad is inside the masked group');
});

s.check('a part with no body of its own is unchanged', () => {
  // A pen wire draws pads and no body, so it has nothing to clear.
  const p = boardm.makeProject({ cols: 12, rows: 8 });
  p.wires.push({ ref: 'A', from: { col: 2, row: 2 }, to: { col: 6, row: 5 } });
  const svg = R.renderBoard(p, {});
  ok(/data-kind="wire-pad"/.test(svg), 'the pen wire still draws its pads');
});

s.check('and every part still renders at every rotation', () => {
  // A control: masking must not break anything that was drawing fine.
  const bad = [];
  for (const part of lib.partList()) {
    if (part.id === 'point-to-point') continue;
    for (const rot of [0, 90, 180, 270]) {
      const pl = { ref: 'X1', part: part.id, at: { col: 6, row: 5 }, rot };
      if (part.parametric === 'span') pl.span = part.defaultSpan ?? 3;
      if (part.defaultWidth != null) pl.width = part.defaultWidth;
      try {
        const svg = render([pl]);
        if (!/data-kind="part"/.test(svg)) bad.push(`${part.id} rot ${rot}: nothing drawn`);
      } catch (e) { bad.push(`${part.id} rot ${rot}: ${e.message}`); }
    }
  }
  eq(bad, [], `these failed to render: ${bad.join(' | ')}`);
});

process.exit(await s.run() ? 0 : 1);
