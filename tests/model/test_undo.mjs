// Undo has to give back the state you were in, not the one you are in.
// Governed by docs/specs/undo-off-by-one.md

import { readFileSync } from 'node:fs';
import { suite, eq, ok, softImport } from '../run.mjs';

const U = await softImport('../../src/model/undo.js', import.meta.url);

const s = suite('undo');

// A project is anything JSON-cloneable; these use a list of refs, which is all
// the stack cares about.
const P = (...refs) => ({ placements: refs.map((r) => ({ ref: r })) });
const refs = (p) => (p?.placements ?? []).map((x) => x.ref);

// -------------------------------------------- the defect where it lives
//
// The rest of this file checks the module. This one check reaches into
// public/app.js, because that is where the bug is and node cannot run it: app.js
// exports nothing, and the boot harness only proves it evaluates. A source
// assertion is weak evidence and is here for one reason — a defect that has
// survived since the editor's first commit survived because nothing could reach
// it, and "no check was possible" is how that happens twice.

s.check('COMMIT DOES NOT SNAPSHOT THE PROJECT IT HAS ALREADY CHANGED', () => {
  // Measured in Chromium before the fix: place R1, place R2, press Undo — the
  // board still had both and the status line said "undone". Every tool mutates
  // state.project in place and THEN calls commit, so pushing state.project
  // there stores the state after the change and undo reinstalls the state you
  // are already in.
  const src = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const body = /function commit\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(src)?.[1];
  ok(body, 'commit() is found');
  ok(!/state\.undo\.push\(JSON\.stringify\(state\.project\)\)/.test(body),
    `commit still pushes the post-change project:\n${body.trim()}`);
});

// ------------------------------------------------------- the defect itself

s.check('THE FIRST CHANGE OF A SESSION IS UNDOABLE', () => {
  // It was not. The stack held the state AFTER each change and nothing ever
  // pushed the state before the first one, so the board you started with was
  // unreachable for the whole session.
  const u = U.makeUndo(P());
  ok(!u.canUndo(), 'nothing to undo before anything happens');
  u.commit(P('R1'));
  ok(u.canUndo(), 'and now there is');
  eq(refs(u.undo(P('R1'))), [], 'back to the empty board');
});

s.check('UNDO RETURNS THE STATE BEFORE THE CHANGE, NOT AFTER IT', () => {
  // Measured before the fix: place R1, place R2, press undo — and the board
  // still had R1 and R2 on it while the status line said "undone".
  const u = U.makeUndo(P());
  u.commit(P('R1'));
  u.commit(P('R1', 'R2'));
  eq(refs(u.undo(P('R1', 'R2'))), ['R1'], 'R2 is gone on the FIRST press');
});

s.check('three changes undo in reverse order', () => {
  const u = U.makeUndo(P());
  u.commit(P('A'));
  u.commit(P('A', 'B'));
  u.commit(P('A', 'B', 'C'));
  let cur = P('A', 'B', 'C');
  cur = u.undo(cur); eq(refs(cur), ['A', 'B'], 'first back');
  cur = u.undo(cur); eq(refs(cur), ['A'], 'second back');
  cur = u.undo(cur); eq(refs(cur), [], 'and back to empty');
  ok(!u.canUndo(), 'the stack is spent');
});

// ------------------------------------------------------------------- redo

s.check('REDO PUTS THEM BACK IN ORDER', () => {
  const u = U.makeUndo(P());
  u.commit(P('A'));
  u.commit(P('A', 'B'));
  let cur = u.undo(P('A', 'B'));
  cur = u.undo(cur);
  eq(refs(cur), [], 'undone to the start');
  cur = u.redo(cur); eq(refs(cur), ['A'], 'A is back');
  cur = u.redo(cur); eq(refs(cur), ['A', 'B'], 'and B');
  ok(!u.canRedo(), 'nothing further');
});

s.check('a new change after an undo clears the redo stack', () => {
  // Otherwise redo would install a state that never followed the one you are in.
  const u = U.makeUndo(P());
  u.commit(P('A'));
  const cur = u.undo(P('A'));
  ok(u.canRedo(), 'redo is available');
  u.commit(P('Z'));
  ok(!u.canRedo(), 'and gone once the history forks');
  eq(refs(cur), [], 'the undone state is untouched');
});

// ------------------------------------------------------------- the edges

s.check('undoing with nothing to undo changes nothing', () => {
  const u = U.makeUndo(P('R1'));
  eq(u.undo(P('R1')), null, 'it says no, rather than returning a wrong board');
  ok(!u.canUndo(), 'still nothing');
});

s.check('redoing with nothing to redo changes nothing', () => {
  const u = U.makeUndo(P('R1'));
  eq(u.redo(P('R1')), null, 'no');
});

s.check('THE BOUND DROPS THE OLDEST, NEVER THE NEWEST', () => {
  // Losing the newest would mean the last thing you did is the one you cannot
  // take back, which is the opposite of what a bound is for.
  // Five commits with a bound of three leaves the three most recent
  // pre-states — b, c, d — so undoing from e gives d, then c, then b, and the
  // oldest two are what went.
  const u = U.makeUndo(P('start'), 3);
  for (const r of ['a', 'b', 'c', 'd', 'e']) u.commit(P(r));
  eq(u.depth(), 3, 'held to the bound');
  let cur = P('e');
  cur = u.undo(cur); eq(refs(cur), ['d'], 'the newest history survives');
  cur = u.undo(cur); eq(refs(cur), ['c'], 'and the one before it');
  cur = u.undo(cur); eq(refs(cur), ['b'], 'down to the oldest kept');
  ok(!u.canUndo(), 'and start and a are gone, being the oldest');
});

s.check('WHAT COMES BACK IS A COPY', () => {
  // A stack that hands out live references corrupts silently: the editor
  // mutates the project in place, so the entry would change under it.
  const u = U.makeUndo(P());
  u.commit(P('R1'));
  const back = u.undo(P('R1'));
  back.placements.push({ ref: 'JUNK' });
  const again = u.redo(back);
  eq(refs(again), ['R1'], 'the stack is unharmed');
});

s.check('the baseline moves when the project is replaced wholesale', () => {
  // Loading a file or restoring a snapshot is not an undoable edit — it is a
  // new starting point, and undoing into the board it replaced would be a
  // surprise rather than a mercy.
  const u = U.makeUndo(P('old'));
  u.commit(P('old', 'edit'));
  u.reset(P('loaded'));
  ok(!u.canUndo(), 'the history goes with the board it belonged to');
  ok(!u.canRedo(), 'and so does the redo stack');
  u.commit(P('loaded', 'edit'));
  eq(refs(u.undo(P('loaded', 'edit'))), ['loaded'], 'undo now works against the new board');
});

process.exit((await s.run()) ? 0 : 1);
