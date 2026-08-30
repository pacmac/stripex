// A part's cuts belong to the part: they move with it and go with it.
// Governed by docs/specs/part-owned-breaks.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const brk = await softImport('../../src/model/breaks.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const lib = await softImport('../../src/parts/library.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const R = await softImport('../../src/render/svg.js', here);
const V = await softImport('../../src/model/views.js', here);

const s = suite('owned-breaks');

const key = (b) => `${b.row}:${b.x}:${b.at ?? 'gap'}`;
const keys = (list) => list.map(key).sort();

function withDip() {
  const p = boardm.makeProject({ cols: 25, rows: 20 });
  // rot 90 straddles the strips, so every strip under it needs cutting
  p.placements.push({ ref: 'U1', part: 'dip', span: 7, width: 3,
    at: { col: 10, row: 5 }, rot: 90 });
  return p;
}

s.check('A PART’S CUTS ARE NOT STORED IN THE PROJECT', () => {
  const p = withDip();
  eq(p.breaks, [], 'project.breaks stays empty');
  ok(brk.effectiveBreaks(p).length > 0, 'but the board has cuts');
});

s.check('a DIP-14 contributes seven of them', () => {
  eq(brk.effectiveBreaks(withDip()).length, 7, 'seven derived cuts');
});

s.check('derived cuts name the part that needs them', () => {
  for (const b of brk.effectiveBreaks(withDip())) {
    eq(b.owner, 'U1', 'owner');
  }
});

s.check('ROTATING THE PART MOVES ITS CUTS, LEAVING NONE BEHIND', () => {
  // The count legitimately changes with orientation: straddling the strips a
  // DIP-14 needs seven cuts, but lying along them it needs six between the pins
  // of each row, so twelve. What must NEVER happen is a cut surviving from the
  // previous orientation, so the property to check is that the board's cuts are
  // exactly the ones this placement requires right now.
  const p = withDip();
  const before = keys(brk.effectiveBreaks(p));
  for (let i = 0; i < 4; i += 1) {
    p.placements[0] = rot.rotatePlacement(p.placements[0], lib.getPart);
    const want = keys(brk.requiredBreaks(p.placements[0], lib.getPart));
    eq(keys(brk.effectiveBreaks(p)), want,
      `after ${i + 1} turn(s) the cuts match the current orientation exactly`);
    eq(p.breaks, [], 'and nothing was left behind in the project');
  }
  ok(JSON.stringify(before) !== JSON.stringify(keys(brk.effectiveBreaks(
    { ...p, placements: [rot.rotatePlacement(withDip().placements[0], lib.getPart)] },
  ))), 'a turned part really does cut somewhere else');
});

s.check('four rotations bring the cuts back to where they started', () => {
  const p = withDip();
  const before = keys(brk.effectiveBreaks(p));
  for (let i = 0; i < 4; i += 1) {
    p.placements[0] = rot.rotatePlacement(p.placements[0], lib.getPart);
  }
  eq(keys(brk.effectiveBreaks(p)), before, 'same cuts');
});

s.check('DELETING THE PART REMOVES ITS CUTS', () => {
  const p = withDip();
  ok(brk.effectiveBreaks(p).length > 0, 'cuts present while the part is');
  p.placements = [];
  eq(brk.effectiveBreaks(p), [], 'and gone with it');
});

s.check('a user cut survives the part being deleted', () => {
  const p = withDip();
  p.breaks.push({ row: 19, x: 2, at: 'gap' });
  p.placements = [];
  eq(brk.effectiveBreaks(p).map(key), ['19:2:gap'], 'only the user cut remains');
});

s.check('a user cut in the same place is not duplicated', () => {
  const p = withDip();
  const derived = brk.effectiveBreaks(p)[0];
  p.breaks.push({ row: derived.row, x: derived.x, at: 'gap' });
  const all = brk.effectiveBreaks(p);
  eq(new Set(all.map(key)).size, all.length, 'no duplicate keys');
  eq(all.length, 7, 'still seven cuts in total');
});

s.check('the user cut wins, so it stays deletable', () => {
  const p = withDip();
  const derived = brk.effectiveBreaks(p)[0];
  // Matched on place, not on place-and-kind: a DIL's derived cut is a spot-face
  // at a hole while the user's is a knife cut in a gap, and one at the same
  // place still supersedes the other.
  p.breaks.push({ row: derived.row, x: derived.x, at: 'gap' });
  const same = brk.effectiveBreaks(p)
    .find((b) => b.row === derived.row && b.x === derived.x);
  ok(same, 'a cut is still there');
  ok(!same.owner, 'the surviving cut has no owner');
  eq(same.at, 'gap', 'and it is the user’s knife cut');
});

s.check('user cuts never carry an owner', () => {
  const p = boardm.makeProject({ cols: 12, rows: 6 });
  p.breaks.push({ row: 1, x: 3, at: 'gap' }, { row: 2, x: 5, at: 'hole' });
  for (const b of brk.effectiveBreaks(p)) ok(!b.owner, `${key(b)} has no owner`);
});

s.check('a board with no such part is unchanged', () => {
  const p = boardm.makeProject({ cols: 12, rows: 6 });
  p.breaks.push({ row: 1, x: 3, at: 'gap' });
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 3,
    at: { col: 1, row: 4 }, rot: 90 });
  eq(keys(brk.effectiveBreaks(p)), keys(p.breaks), 'effective equals stored');
});

s.check('ownerOf finds the part responsible for a cut', () => {
  const p = withDip();
  const derived = brk.effectiveBreaks(p).find((b) => b.owner);
  eq(brk.ownerOf(p, derived.row, derived.x), 'U1', 'owned cut');
  eq(brk.ownerOf(p, 19, 1), null, 'a place with no cut at all');
});

s.check('a user cut is not reported as owned', () => {
  const p = boardm.makeProject({ cols: 12, rows: 6 });
  p.breaks.push({ row: 1, x: 3, at: 'gap' });
  eq(brk.ownerOf(p, 1, 3), null, 'user cut has no owner');
});

// ------------------------------------------------------- what the board shows

s.check('THE DRAWN BOARD IS CUT WHERE THE PART NEEDS IT', () => {
  const p = withDip();
  const svg = R.renderBoard(p, {});
  const marks = [...svg.matchAll(/data-kind="break"/g)];
  eq(marks.length, 7, 'seven cut markers drawn');
});

s.check('and the strips are actually severed, not just marked', () => {
  const p = withDip();
  const segCount = (proj) => V.netsFor(proj).nets.length;
  const withPart = segCount(p);
  p.placements = [];
  ok(withPart > segCount(p), 'the part splits strips into more nets than a bare board');
});

s.check('a DIL is not reported as shorted, because its cuts are there', () => {
  const errors = V.findingsFor(withDip()).filter((f) => f.severity === 'error');
  eq(errors, [], 'no errors');
});

s.check('DELETING THE PART UN-SPLITS THE STRIPS IT CUT', () => {
  const p = withDip();
  const before = V.netsFor(p).nets.length;
  p.placements = [];
  const after = V.netsFor(p).nets.length;
  ok(after < before, `nets went ${before} -> ${after}`);
  eq(after, p.board.rows, 'back to one net per strip');
});

process.exit((await s.run()) ? 0 : 1);
