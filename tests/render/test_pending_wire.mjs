// A half-drawn wire has to be visible on the board.
// Governed by docs/specs/pending-wire-feedback.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const V = await softImport('../../src/model/views.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const geom = await softImport('../../src/model/geometry.js', here);

const s = suite('pending-wire');

const els = (svg, kind) => [...String(svg).matchAll(
  new RegExp(`<[^>]*data-kind="${kind}"[^>]*>`, 'g'),
)].map((m) => m[0]);
const attr = (el, name) => {
  const m = el.match(new RegExp(`(?:^|[ ])${name}="([^"]*)"`));
  return m ? m[1] : null;
};

const board = () => boardm.makeProject({ cols: 16, rows: 10 });
const pending = { col: 4, row: 3 };

s.check('NOTHING EXTRA IS DRAWN WHEN NO WIRE IS PENDING', () => {
  const svg = R.renderBoard(board(), {});
  eq(els(svg, 'wire-start').length, 0, 'no marker');
  eq(els(svg, 'wire-band').length, 0, 'no band');
});

s.check('A PENDING WIRE PUTS A MARKER ON ITS HOLE', () => {
  // The whole complaint: before this, the board was byte identical after the
  // first click and the only feedback was a line of text at the bottom edge.
  const svg = R.renderBoard(board(), { pendingWire: pending });
  const marks = els(svg, 'wire-start');
  eq(marks.length, 1, 'exactly one marker');
  const p = geom.holeToMm(pending.col, pending.row);
  eq([Number(attr(marks[0], 'cx')), Number(attr(marks[0], 'cy'))], [p.x, p.y], 'on the hole');
  eq(attr(marks[0], 'data-hole'), '4,3', 'and it says which hole');
});

s.check('THE MARKER IS DRAWN LAST, SO NOTHING COVERS IT', () => {
  const svg = R.renderBoard(board(), { pendingWire: pending });
  const at = svg.indexOf('data-kind="wire-start"');
  for (const kind of ['copper', 'hole', 'substrate']) {
    ok(svg.indexOf(`data-kind="${kind}"`) < at, `${kind} is painted before it`);
  }
});

s.check('a rubber band starts at that hole', () => {
  const svg = R.renderBoard(board(), { pendingWire: pending });
  const band = els(svg, 'wire-band');
  eq(band.length, 1, 'one band');
  const p = geom.holeToMm(pending.col, pending.row);
  eq([Number(attr(band[0], 'x1')), Number(attr(band[0], 'y1'))], [p.x, p.y], 'from the hole');
});

s.check('THE BAND CANNOT EAT THE SECOND CLICK', () => {
  // It is drawn on top and follows the cursor, so it lies under the pointer at
  // the moment you click. Without this it would take the click meant for the
  // hole.
  const svg = R.renderBoard(board(), { pendingWire: pending });
  eq(attr(els(svg, 'wire-band')[0], 'pointer-events'), 'none', 'band is inert');
  eq(attr(els(svg, 'wire-start')[0], 'pointer-events'), 'none', 'so is the marker');
});

s.check('the band starts collapsed on the hole, not pointing somewhere arbitrary', () => {
  const band = els(R.renderBoard(board(), { pendingWire: pending }), 'wire-band')[0];
  eq([attr(band, 'x1'), attr(band, 'y1')], [attr(band, 'x2'), attr(band, 'y2')],
    'both ends on the hole until the pointer moves');
});

s.check('the marker uses the same colour as the move anchor', () => {
  // Both mean "the editor is holding this point and waiting for you", so they
  // should not look like two different things.
  const svg = R.renderBoard(board(), { pendingWire: pending });
  eq(attr(els(svg, 'wire-start')[0], 'stroke'), R.THEMES.light.select, 'selection colour');
});

s.check('it mirrors with the underside view like everything else', () => {
  const p = board();
  const w = geom.boardSizeMm(p.board).w;
  const svg = R.renderBoard(p, { pendingWire: pending, view: 'underside' });
  const mark = els(svg, 'wire-start')[0];
  eq(Number(attr(mark, 'cx')), w - geom.holeToMm(pending.col, pending.row).x, 'mirrored');
});

s.check('A HALF-DRAWN WIRE IS NOT A WIRE', () => {
  // It must not reach the project, the run list or the nets.
  const p = board();
  R.renderBoard(p, { pendingWire: pending });
  eq(p.wires, [], 'no wire stored');
  eq(V.runList(p), [], 'and none in the run list');
  eq(els(R.renderBoard(p, { pendingWire: pending }), 'wire-pad').length, 0, 'and no pads');
});

s.check('a malformed pending value is ignored rather than throwing', () => {
  for (const bad of [null, {}, { col: 1 }, { col: 'x', row: 2 }]) {
    const svg = R.renderBoard(board(), { pendingWire: bad });
    eq(els(svg, 'wire-start').length, 0, `${JSON.stringify(bad)} draws nothing`);
  }
});

process.exit((await s.run()) ? 0 : 1);
