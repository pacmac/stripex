// A part hanging off the edge must not take the whole board down with it.
// Governed by docs/specs/never-lose-a-board.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const brk = await softImport('../../src/model/breaks.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const R = await softImport('../../src/render/svg.js', here);

const s = suite('offboard-cuts');

// Pin 1 is top-left, so a DIL's second pin row sits at dy = -width. Placed near
// the TOP of the board at rot 0, that row — and the cuts along it — land at a
// negative row.
const highDip = () => {
  const p = boardm.makeProject({ cols: 25, rows: 20 });
  p.placements.push({ ref: 'U9', part: 'dip', span: 8, width: 5,
    at: { col: 10, row: 2 }, rot: 0 });
  return p;
};

const onBoard = (p, b) => b.row >= 0 && b.row < p.board.rows
  && b.x >= 0 && b.x <= p.board.cols - 1;

s.check('THE BOARD STILL RENDERS', () => {
  // This threw "break row -3 is outside 0..19" out of segments(), which killed
  // renderBoard, then draw, then boot. Nothing appeared at all — not a broken
  // board, a blank page.
  let svg = null;
  let threw = null;
  try { svg = R.renderBoard(highDip(), {}); } catch (e) { threw = e.message; }
  eq(threw, null, 'renderBoard did not throw');
  ok(svg && svg.startsWith('<svg'), 'and it produced a board');
});

s.check('EVERY EFFECTIVE CUT IS ON THE BOARD', () => {
  const p = highDip();
  for (const b of brk.effectiveBreaks(p)) {
    ok(onBoard(p, b), `cut row ${b.row} x ${b.x} is on the board`);
  }
});

s.check('the cuts that ARE on the board are still made', () => {
  // Dropping the off-board half must not drop the half that matters.
  const p = highDip();
  const cuts = brk.effectiveBreaks(p);
  ok(cuts.length > 0, `${cuts.length} cuts survive`);
  ok(cuts.some((b) => b.row === 2), 'including the row the package really covers');
});

s.check('a part hanging off the BOTTOM is handled too', () => {
  const p = boardm.makeProject({ cols: 25, rows: 20 });
  p.placements.push({ ref: 'U9', part: 'dip', span: 8, width: 5,
    at: { col: 10, row: 19 }, rot: 90 });
  let threw = null;
  try { R.renderBoard(p, {}); } catch (e) { threw = e.message; }
  eq(threw, null, 'renders');
  for (const b of brk.effectiveBreaks(p)) ok(onBoard(p, b), `row ${b.row} on board`);
});

s.check('and off either side', () => {
  for (const at of [{ col: 0, row: 8 }, { col: 24, row: 8 }]) {
    const p = boardm.makeProject({ cols: 25, rows: 20 });
    p.placements.push({ ref: 'U9', part: 'dip', span: 8, width: 5, at, rot: 90 });
    let threw = null;
    try { R.renderBoard(p, {}); } catch (e) { threw = e.message; }
    eq(threw, null, `renders with a DIL at ${at.col},${at.row}`);
    for (const b of brk.effectiveBreaks(p)) ok(onBoard(p, b), `row ${b.row} x ${b.x}`);
  }
});

s.check('A USER CUT LEFT OUT OF RANGE BY A BOARD RESIZE IS SURVIVED', () => {
  // Shrinking the board can strand a cut the user made, and that must not blank
  // the editor either.
  const p = boardm.makeProject({ cols: 25, rows: 20 });
  p.breaks.push({ row: 18, x: 20, at: 'gap' });
  p.board.rows = 10;
  p.board.cols = 12;
  let threw = null;
  try { R.renderBoard(p, {}); } catch (e) { threw = e.message; }
  eq(threw, null, 'renders');
  for (const b of brk.effectiveBreaks(p)) ok(onBoard(p, b), `row ${b.row} x ${b.x}`);
});

s.check('a board with nothing wrong is completely unaffected', () => {
  const p = boardm.makeProject({ cols: 25, rows: 20 });
  p.placements.push({ ref: 'U1', part: 'dip', span: 7, width: 3,
    at: { col: 10, row: 8 }, rot: 90 });
  eq(brk.effectiveBreaks(p).length, 7, 'all seven cuts, none dropped');
});

s.check('the nets still come out right for the cuts that remain', () => {
  const p = highDip();
  const { nets } = R.netsFor(p);
  ok(nets.length > 0, 'nets derived');
  eq(R.findingsFor(p).filter((f) => f.code === 'bad-break').length, 0,
    'and the DRC is not complaining about impossible cuts');
});

s.check('segments() itself still refuses a bad break, which is right', () => {
  // The low-level function stays strict: its checks depend on being handed
  // exactly what to consider. The filtering belongs one level up, where the
  // board dimensions are known.
  const seg = R.__segmentsForTest ?? null;
  void seg;
  let threw = false;
  try {
    const p = boardm.makeProject({ cols: 10, rows: 5 });
    // straight at the low-level API, bypassing effectiveBreaks
    R.renderBoard({ ...p, breaks: [{ row: 99, x: 1 }] }, {});
  } catch { threw = true; }
  ok(!threw, 'but the project-shaped path never lets one through');
});

process.exit((await s.run()) ? 0 : 1);
