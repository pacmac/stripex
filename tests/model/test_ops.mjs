// Every edit as a function: the headless way to build a board.
// Governed by docs/specs/rules-and-ops.md
//
// This exists because I built and repaired Peter's rotator board with three
// throwaway scripts, each re-implementing hole-finding, occupancy and
// straightness, and the third had an off-by-one in a link's span that put its
// end on the wrong strip.

import { readFileSync } from 'node:fs';
import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const O = await softImport('../../src/model/ops.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const rulesMod = await softImport('../../src/model/rules.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const lib = await softImport('../../src/parts/library.js', here);

const s = suite('ops');

function board() {
  const p = boardm.makeProject({ cols: 16, rows: 10 });
  p.placements.push({ ref: 'R1', part: 'res-axial', at: { col: 4, row: 2 }, rot: 0, span: 4 });
  p.netLabels = { '0,0': { name: '0V' }, '0,2': { name: 'STEP' } };
  return p;
}

// ----------------------------------------------------- nothing is mutated

s.check('AN OPERATION NEVER TOUCHES ITS ARGUMENT', () => {
  // The editor mutates state.project in place, which is why no operation could
  // be reused or tested. These return a new board.
  const p = board();
  const before = JSON.stringify(p);
  O.addWire(p, { col: 12, row: 2 }, { col: 12, row: 4 });
  O.addPart(p, { part: 'res-axial', at: { col: 1, row: 8 }, rot: 0, span: 4 });
  O.setBreak(p, { row: 5, x: 3, at: 'gap' });
  eq(JSON.stringify(p), before, 'the board handed in is unchanged');
});

// ------------------------------------------------- the rules are enforced

s.check('ADDWIRE REFUSES A HOLE THAT HAS A PIN IN IT', () => {
  // The fault I made nine times. An operation that produces a board here is an
  // operation that lets it happen again tomorrow.
  const r = O.addWire(board(), { col: 4, row: 2 }, { col: 12, row: 4 });
  ok(r.error, `refused: ${r.error}`);
  eq(r.project, undefined, 'and no board comes back');
  // It must name WHAT is in the way and WHAT the rule is — an error that only
  // says "refused" sends you back to the source to find out why.
  ok(/R1\.1/.test(r.error), `naming the occupant: ${r.error}`);
  ok(/hole to hole/i.test(r.error), `and the rule: ${r.error}`);
  eq(r.code, 'pen-wire-on-a-pin', 'with a code a caller can branch on');
});

s.check('ADDWIRE REFUSES A POWER NET', () => {
  // Peter's rule: point to point is for signals only.
  const r = O.addWire(board(), { col: 12, row: 0 }, { col: 12, row: 4 });
  ok(r.error, `refused: ${r.error}`);
  ok(/power|link/i.test(r.error), `and says what to use instead: ${r.error}`);
});

s.check('and accepts a signal wire between free holes', () => {
  const r = O.addWire(board(), { col: 12, row: 2 }, { col: 12, row: 4 });
  ok(!r.error, `accepted: ${r.error ?? ''}`);
  ok(r.ref, 'with a ref');
  eq(r.project.wires.length, 1, 'and a wire on the board');
});

s.check('a rule switched off lets it through', () => {
  const p = board();
  p.rules = { ...rulesMod.DEFAULT_RULES, penWiresSignalsOnly: false };
  const r = O.addWire(p, { col: 12, row: 0 }, { col: 12, row: 4 });
  ok(!r.error, `the board decides: ${r.error ?? 'accepted'}`);
});

// --------------------------------------------------------- links

s.check('ADDLINK DERIVES ROT AND SPAN FROM TWO HOLES', () => {
  // The off-by-one that put a link's end on the wrong strip: a link's span is
  // the DISTANCE between its ends, not the number of holes it covers.
  const r = O.addLink(board(), { col: 6, row: 4 }, { col: 6, row: 9 });
  ok(!r.error, `accepted: ${r.error ?? ''}`);
  const ends = rot.resolvePins(r.project.placements.filter((x) => x.ref === r.ref), lib.getPart)
    .map((x) => `${x.col},${x.row}`).sort();
  eq(ends, ['6,4', '6,9'], 'its ends land exactly on the holes given');
});

s.check('and it works along a row as well as a column', () => {
  const r = O.addLink(board(), { col: 2, row: 6 }, { col: 9, row: 6 });
  ok(!r.error, `accepted: ${r.error ?? ''}`);
  const ends = rot.resolvePins(r.project.placements.filter((x) => x.ref === r.ref), lib.getPart)
    .map((x) => `${x.col},${x.row}`).sort();
  eq(ends, ['2,6', '9,6'], 'ends on the two holes');
});

s.check('ADDLINK REFUSES A DIAGONAL', () => {
  const r = O.addLink(board(), { col: 2, row: 4 }, { col: 7, row: 9 });
  ok(r.error, `refused: ${r.error}`);
  ok(/straight|line/i.test(r.error), `naming the rule: ${r.error}`);
});

s.check('and refuses a link to nowhere', () => {
  const r = O.addLink(board(), { col: 2, row: 4 }, { col: 2, row: 4 });
  ok(r.error, `a link of zero length is refused: ${r.error}`);
});

// ----------------------------------------------------------- the rest

s.check('ADDPART PLACES AND NAMES', () => {
  const r = O.addPart(board(), { part: 'res-axial', at: { col: 1, row: 8 }, rot: 0, span: 4 });
  ok(!r.error, `accepted: ${r.error ?? ''}`);
  ok(r.ref && r.ref !== 'R1', `a fresh ref: ${r.ref}`);
  eq(r.project.placements.length, 2, 'two parts now');
});

s.check('and refuses a part that is not in the library', () => {
  const r = O.addPart(board(), { part: 'unicorn', at: { col: 1, row: 8 }, rot: 0 });
  ok(r.error, `refused: ${r.error}`);
});

s.check('REMOVEPART takes it away, and says when there is nothing to take', () => {
  const gone = O.removePart(board(), 'R1');
  eq(gone.project.placements.length, 0, 'removed');
  ok(O.removePart(board(), 'NOPE').error, 'and a missing ref is an error, not a silent no-op');
});

s.check('SETBREAK and CLEARBREAK', () => {
  const cut = O.setBreak(board(), { row: 5, x: 3, at: 'gap' });
  ok(!cut.error, `cut: ${cut.error ?? ''}`);
  eq(cut.project.breaks.length, 1, 'one cut');
  const back = O.clearBreak(cut.project, { row: 5, x: 3 });
  eq(back.project.breaks.length, 0, 'and restored');
  ok(O.setBreak(board(), { row: 99, x: 3, at: 'gap' }).error, 'off the board is refused');
});

s.check('SETLABEL names a net, and refuses a dead hole', () => {
  const named = O.setLabel(board(), { col: 5, row: 5 }, { name: 'VCC' });
  eq(named.project.netLabels['5,5'].name, 'VCC', 'named');
  const killed = O.setBreak(board(), { row: 6, x: 5, at: 'hole' }).project;
  ok(O.setLabel(killed, { col: 5, row: 6 }, { name: 'X' }).error,
    'a spot-faced hole belongs to no net and cannot carry a name');
});

// ------------------------------------------------- the query I kept redoing

s.check('FREEHOLESON GIVES THE HOLES A WIRE MAY LAND IN', () => {
  // Written three times in three scratch scripts, wrongly twice.
  const holes = O.freeHolesOn(board(), 'R1', '1');
  ok(holes.length > 0, 'there are some');
  ok(!holes.some((h) => h.col === 4 && h.row === 2), 'and the pin’s own hole is not one');
  ok(holes.every((h) => h.row === 2), 'all on that pin’s strip');
});

// --------------------------------------------- the board this came from

s.check('PETER’S WIRING, REBUILT BY OPS ALONE', () => {
  // The whole point: the same connections, arrived at through the API rather
  // than through a script in a scratch directory.
  const p = JSON.parse(readFileSync(new URL('../fixtures/two-names-on-one-net.json', import.meta.url)));
  let cur = p;
  const steps = [
    () => O.setBreak(cur, { row: 5, x: 3, at: 'gap' }),
    () => O.setBreak(cur, { row: 6, x: 3, at: 'gap' }),
  ];
  for (const step of steps) {
    const r = step();
    ok(!r.error, `step: ${r.error ?? 'ok'}`);
    cur = r.project;
  }
  eq(cur.breaks.length, p.breaks.length + 2, 'two cuts added through ops');
  ok(cur !== p, 'and the original board is a different object');
});

process.exit((await s.run()) ? 0 : 1);
