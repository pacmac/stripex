// A board can be resized in place, and is refused when something falls off.
// Governed by docs/specs/board-queries-and-resize.md
//
// There was no op and no endpoint for board.cols/rows, so making the 555 board
// narrower meant DELETE and rebuild — three times, twenty to fourteen to twelve
// to eleven columns, about thirty ops re-sent each round and the board losing
// its identity and history every time.
//
// SILENTLY TRUNCATING IS THE ONE BEHAVIOUR WORSE THAN REFUSING. A part half off
// the edge is a board that still looks plausible.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const O = await softImport('../../src/model/ops.js', here);
const V = await softImport('../../src/model/views.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('resize');

// A resistor at cols 2-5 on row 2, a wire out at col 9, a cut at row 4, and a
// name on a hole near the right edge — one of each thing a resize can strand.
function board() {
  const p = boardm.makeProject({ cols: 12, rows: 8 });
  p.placements.push({ ref: 'R1', part: 'res-axial', at: { col: 2, row: 2 }, rot: 0, span: 3 });
  p.wires.push({ ref: 'A', from: { col: 1, row: 6 }, to: { col: 9, row: 6 } });
  p.breaks.push({ row: 4, x: 3, at: 'gap' });
  p.netLabels = { '0,0': { name: '0V' } };
  return p;
}

s.check('A BOARD THAT FITS IS RESIZED IN PLACE', () => {
  const p = board();
  const out = O.setBoardSize(p, { cols: 10, rows: 7 });
  ok(!out.error, `it applied: ${out.error ?? ''}`);
  eq(out.project.board.cols, 10, 'columns');
  eq(out.project.board.rows, 7, 'rows');
  eq(p.board.cols, 12, 'and the board it was given is untouched');
});

s.check('and the circuit it describes is unchanged by the resize', () => {
  // A resize that altered connectivity would not be a resize.
  //
  // NETS THAT CARRY PINS, not every net. Shrinking a board legitimately removes
  // empty strips — that is the point of shrinking it — so counting those would
  // assert the board did not get smaller.
  const carried = (proj) => V.netsFor(proj).nets
    .map((n) => n.pins.map((x) => `${x.ref}.${x.pin}`).sort().join(' '))
    .filter(Boolean).sort();
  const p = board();
  const before = carried(p);
  const after = carried(O.setBoardSize(p, { cols: 10, rows: 7 }).project);
  eq(after, before, 'the same nets carry the same pins');
});

s.check('IT IS REFUSED WHEN A PIN WOULD FALL OFF, AND NAMES IT', () => {
  // R1's far lead is at col 5.
  const out = O.setBoardSize(board(), { cols: 5, rows: 8 });
  ok(out.error, 'refused');
  ok(/R1/.test(out.error), `naming the part: ${out.error}`);
});

s.check('and when a wire end would', () => {
  // The pen wire reaches col 9.
  const out = O.setBoardSize(board(), { cols: 8, rows: 8 });
  ok(out.error, 'refused');
  ok(/\bA\b/.test(out.error), `naming the wire: ${out.error}`);
});

s.check('and when a cut would', () => {
  const out = O.setBoardSize(board(), { cols: 12, rows: 4 });
  ok(out.error, 'refused');
  ok(/cut|break/i.test(out.error), `saying what it is: ${out.error}`);
});

s.check('and when a net name would', () => {
  // The label is at (0,0) so shrinking cannot strand it; put one at the edge.
  const p = board();
  p.netLabels['11,7'] = { name: 'EDGE' };
  const out = O.setBoardSize(p, { cols: 11, rows: 8 });
  ok(out.error, 'refused');
  ok(/EDGE|11,7|name/i.test(out.error), `naming it: ${out.error}`);
});

s.check('GROWING A BOARD IS NEVER REFUSED', () => {
  const out = O.setBoardSize(board(), { cols: 40, rows: 30 });
  ok(!out.error, `it applied: ${out.error ?? ''}`);
  eq(out.project.board.cols, 40, 'columns');
});

s.check('a size that is not a size is refused', () => {
  for (const bad of [{ cols: 0, rows: 8 }, { cols: 12, rows: 1 }, { cols: 'wide', rows: 8 }]) {
    const out = O.setBoardSize(board(), bad);
    ok(out.error, `${JSON.stringify(bad)} was refused: ${out.error ?? 'it was not'}`);
  }
});

s.check('AND IT IS AN OP LIKE ANY OTHER', () => {
  // Through applyOps, so it gets the batch's all-or-nothing and the version
  // guard, and needs no route of its own.
  ok(O.OP_NAMES.includes('setBoardSize'), `registered: ${O.OP_NAMES.join(' ')}`);
  const p = board();
  const out = O.applyOps(p, [
    { op: 'setBoardSize', cols: 10, rows: 7 },
    { op: 'addLink', from: { col: 0, row: 0 }, to: { col: 0, row: 6 } },
  ]);
  ok(!out.error, `the batch applied: ${out.error ?? ''}`);
  eq(out.project.board.cols, 10, 'the resize took');

  // And a batch that resizes then breaks changes nothing at all.
  const bad = O.applyOps(p, [
    { op: 'setBoardSize', cols: 10, rows: 7 },
    { op: 'addLink', from: { col: 0, row: 0 }, to: { col: 5, row: 5 } },   // diagonal
  ]);
  ok(bad.error, 'the bad batch was refused');
  eq(p.board.cols, 12, 'and the board is untouched');
});

process.exit(await s.run() ? 0 : 1);
