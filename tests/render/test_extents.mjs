// The drawing is as big as what is drawn, and a land has no pin 1.
// Governed by docs/specs/extents-and-smt-lands.md
//
// Peter, 2026-08-31: "in my design the JST 3 pin connector is now partly
// obscured hidden at the overflow at the top, so the board size / auto zoom
// will need to include the extents of any component footprints on the board and
// not just the board size itself. for smt resistors, both ends / pins should be
// a square footprint and not one round and one square."
//
// Both were surfaced by the JST body being corrected to its real size. At the
// old, too-small size the same connector fitted — correcting one drawing
// exposed the other.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const D = await softImport('../../src/parts/devices.js', here);
const lib = await softImport('../../src/parts/library.js', here);
const rot_ = await softImport('../../src/model/rotate.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const G = await softImport('../../src/model/geometry.js', here);

const s = suite('extents');

const PITCH = G.PITCH_MM;

const viewBoxOf = (svg) => {
  const m = /viewBox="(-?[0-9.]+) (-?[0-9.]+) ([0-9.]+) ([0-9.]+)"/.exec(svg);
  ok(m, `there is a viewBox: ${svg.slice(0, 120)}`);
  const [x, y, w, h] = m.slice(1).map(Number);
  return { x, y, w, h, right: x + w, bottom: y + h };
};

function render(placements, cols = 20, rows = 12) {
  const p = boardm.makeProject({ cols, rows });
  for (const pl of placements) p.placements.push(pl);
  return R.renderBoard(p, {});
}

// ------------------------------------------------- the drawing must fit

s.check('A BODY OVER THE TOP EDGE IS INSIDE THE DRAWING', () => {
  // A right-angle JST on row 0. Its housing lies 9.2 mm past the pin row, so at
  // rot 180 it reaches above the board and there was simply no canvas there.
  const vb = viewBoxOf(render([D.placementFor('jst-xh-3-right', { col: 4, row: 0 }, 180, 'J1')]));
  ok(vb.y < 0, `the drawing starts above the board: y=${vb.y.toFixed(2)}`);
  ok(vb.y <= -6, `and by enough to hold the housing: y=${vb.y.toFixed(2)}`);
});

s.check('and one over the bottom edge is too', () => {
  const rows = 12;
  const vb = viewBoxOf(render([D.placementFor('jst-xh-3-right', { col: 4, row: rows - 1 }, 0, 'J1')], 20, rows));
  ok(vb.bottom > rows * PITCH + 5,
    `the drawing reaches past the last row: bottom=${vb.bottom.toFixed(2)} vs board ${(rows * PITCH).toFixed(2)}`);
});

s.check('and one over the left edge is inside the drawing', () => {
  // CONTAINMENT, NOT MOVEMENT. This first asserted the viewBox grew leftwards,
  // and it does not need to: a right-angle body reaches at most 9.2 - 1.27 =
  // 7.93 mm past the left edge, and the net-name gutter is already 8.13 mm. The
  // question is whether the body is drawn, not whether the window moved.
  const svg = render([D.placementFor('jst-xh-4-right', { col: 0, row: 5 }, 90, 'J1')]);
  const vb = viewBoxOf(svg);
  const g = /<g transform="translate\((-?[0-9.]+) (-?[0-9.]+)\) rotate\((-?[0-9.]+)\)">([\s\S]*?)<\/g>/.exec(svg);
  ok(g, 'the body is drawn in a rotated group');
  const [tx, ty, deg] = g.slice(1, 4).map(Number);
  const rad = (deg * Math.PI) / 180;
  const m = /<rect [^>]*x="(-?[0-9.]+)" y="(-?[0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/.exec(g[4]);
  const [x, y, w, h] = m.slice(1).map(Number);
  const xs = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]
    .map(([px, py]) => tx + px * Math.cos(rad) - py * Math.sin(rad));
  ok(Math.min(...xs) >= vb.x - 0.01,
    `the housing's left edge ${Math.min(...xs).toFixed(2)} is inside the drawing at ${vb.x.toFixed(2)}`);
});

s.check('A BOARD WITH NOTHING OVERHANGING DOES NOT MOVE', () => {
  // Ordinary boards must not resize because this exists.
  const empty = viewBoxOf(render([]));
  const inside = viewBoxOf(render([
    { ref: 'R1', part: 'res-axial', at: { col: 5, row: 5 }, rot: 0, span: 3 },
  ]));
  eq(inside, empty, 'the viewBox is unchanged by a part well inside the board');
  eq(empty.y, 0, 'and an empty board still starts at the board top');
});

s.check('EVERY PART AT EVERY ROTATION DRAWS INSIDE THE EXTENT', () => {
  // The check that stops the extent and the drawing drifting apart. Parsed from
  // the emitted primitives, so it measures what is really on the canvas.
  // AT THE EDGES, NOT MID-BOARD. The first version placed everything in the
  // middle of a 20x12 board, where nothing can overhang — so it passed before
  // the fix and proved nothing. A body only escapes the drawing at an edge.
  const bad = [];
  const COLS = 20;
  const ROWS = 12;
  const spots = [{ col: 6, row: 5 }, { col: 3, row: 0 }, { col: 3, row: ROWS - 1 },
    { col: 0, row: 5 }, { col: COLS - 1, row: 5 }];
  for (const part of lib.partList()) {
    if (part.id === 'point-to-point') continue;          // no body of its own
    for (const rot of [0, 90, 180, 270]) {
      for (const at of spots) {
        const pl = { ref: 'X1', part: part.id, at, rot };
        if (part.parametric === 'span') pl.span = part.defaultSpan ?? 3;
        if (part.defaultWidth != null) pl.width = part.defaultWidth;

        // Only placements whose PINS are all on the board: a part hanging its
        // leads into space is not a layout, and the extent owes it nothing.
        let pins = [];
        try { pins = rot_.resolvePins([pl], lib.getPart); } catch { continue; }
        if (pins.some((p) => p.col < 0 || p.row < 0 || p.col >= COLS || p.row >= ROWS)) continue;

        let svg;
        try { svg = render([pl], COLS, ROWS); } catch { continue; }
        const vb = viewBoxOf(svg);

      // THROUGH THE TRANSFORM. Several bodies — axial, chip, jst — are drawn in
      // a `<g transform="translate(..) rotate(..)">` with local coordinates, so
      // comparing those numbers to the viewBox directly is meaningless. The
      // first version of this check did exactly that and reported every axial
      // resistor as outside the drawing.
      for (const g of svg.matchAll(
        /<g transform="translate\((-?[0-9.]+) (-?[0-9.]+)\) rotate\((-?[0-9.]+)\)">([\s\S]*?)<\/g>/g)) {
        const [tx, ty, deg] = g.slice(1, 4).map(Number);
        const rad = (deg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        for (const m of g[4].matchAll(/<rect [^>]*x="(-?[0-9.]+)" y="(-?[0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g)) {
          const [x, y, w, h] = m.slice(1).map(Number);
          for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
            const ax = tx + px * cos - py * sin;
            const ay = ty + px * sin + py * cos;
            if (ax < vb.x - 0.01 || ay < vb.y - 0.01 || ax > vb.right + 0.01 || ay > vb.bottom + 0.01) {
              bad.push(`${part.id} rot ${rot}: body corner ${ax.toFixed(2)},${ay.toFixed(2)}`
                + ` outside ${vb.x.toFixed(2)},${vb.y.toFixed(2)} ${vb.right.toFixed(2)},${vb.bottom.toFixed(2)}`);
            }
          }
        }
        }
      }
    }
  }
  eq(bad.slice(0, 4), [], `${bad.length} draw outside the extent: ${bad.slice(0, 4).join(' | ')}`);
});

// ------------------------------------------------- an SMT land has no pin 1

const padsOf = (svg) => [...svg.matchAll(/<(rect|circle) data-kind="pad"[^>]*data-pin="([^"]*)"[^>]*>/g)]
  .map((m) => ({ shape: m[1], pin: m[2] }));

s.check('BOTH LANDS OF AN SMT PART ARE SQUARE', () => {
  for (const id of ['smt-0603', 'smt-0603-cap']) {
    const pads = padsOf(render([{ ref: 'X1', part: id, at: { col: 5, row: 5 }, rot: 0 }]));
    eq(pads.length, 2, `${id} has two pads`);
    eq(pads.map((p) => p.shape), ['rect', 'rect'],
      `${id} draws both as rectangles: ${JSON.stringify(pads)}`);
  }
});

s.check('and a through-hole part still marks pin 1', () => {
  // The square is how you orient a DIL, and that must not be lost.
  const pads = padsOf(render([
    { ref: 'U1', part: 'dip', at: { col: 4, row: 3 }, rot: 0, span: 4, width: 3 },
  ]));
  eq(pads[0].shape, 'rect', 'pin 1 is square');
  ok(pads.slice(1).every((p) => p.shape === 'circle'),
    `and the rest are round: ${JSON.stringify(pads.map((p) => p.shape))}`);
});

s.check('and the pads still carry what the editor hit-tests on', () => {
  const svg = render([{ ref: 'X1', part: 'smt-0603', at: { col: 5, row: 5 }, rot: 0 }]);
  ok(/data-kind="pad"[^>]*data-pin="1"/.test(svg), 'data-pin survives');
  ok(/data-first="true"/.test(svg), 'and data-first, which says which end is pin 1');
});

process.exit(await s.run() ? 0 : 1);
