// Checks that rotating a part turns it where it sits.
// Governed by docs/specs/rotate-in-place.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const rot = await softImport('../../src/model/rotate.js', here);
const lib = await softImport('../../src/parts/library.js', here);

const s = suite('rotate-in-place');

const centreOf = (pl) => {
  const pins = rot.resolvePins([pl], lib.getPart);
  const cols = pins.map((p) => p.col);
  const rows = pins.map((p) => p.row);
  return {
    col: (Math.min(...cols) + Math.max(...cols)) / 2,
    row: (Math.min(...rows) + Math.max(...rows)) / 2,
  };
};

const drift = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));

const R1 = () => ({ ref: 'R1', part: 'res-axial', span: 4, at: { col: 10, row: 8 }, rot: 0 });
const U1 = () => ({ ref: 'U1', part: 'dip', span: 7, at: { col: 10, row: 8 }, rot: 0 });
const D1 = () => ({ ref: 'D1', part: 'diode', span: 3, at: { col: 10, row: 8 }, rot: 0 });

s.check('rotatePlacement returns a new object and does not mutate the input', () => {
  const before = R1();
  const snapshot = JSON.stringify(before);
  const after = rot.rotatePlacement(before, lib.getPart);
  eq(JSON.stringify(before), snapshot, 'input untouched');
  ok(after !== before, 'a new object came back');
});

s.check('one turn advances the angle by 90', () => {
  eq(rot.rotatePlacement(R1(), lib.getPart).rot, 90, 'rot after one turn');
});

s.check('the angle wraps at 360, never exceeding 270', () => {
  let pl = { ...R1(), rot: 270 };
  pl = rot.rotatePlacement(pl, lib.getPart);
  eq(pl.rot, 0, '270 + 90 is 0');
});

s.check('AN AXIAL PART STAYS PUT WHEN IT TURNS', () => {
  const start = R1();
  const was = centreOf(start);
  const now = centreOf(rot.rotatePlacement(start, lib.getPart));
  ok(drift(was, now) <= 0.5, `centre moved ${drift(was, now)} holes, want <= 0.5`);
});

s.check('...and stays put through all four angles', () => {
  let pl = R1();
  const was = centreOf(pl);
  for (let i = 0; i < 4; i += 1) {
    pl = rot.rotatePlacement(pl, lib.getPart);
    const d = drift(was, centreOf(pl));
    ok(d <= 0.5, `after ${i + 1} turn(s) the centre moved ${d} holes`);
  }
});

s.check('FOUR TURNS RETURN THE PART EXACTLY TO WHERE IT STARTED', () => {
  // The check that catches rounding drift. A part that creeps one hole every
  // time you cycle it through 360 degrees is worse than one that swings.
  for (const make of [R1, U1, D1]) {
    const start = make();
    let pl = start;
    for (let i = 0; i < 4; i += 1) pl = rot.rotatePlacement(pl, lib.getPart);
    eq({ at: pl.at, rot: pl.rot }, { at: start.at, rot: start.rot },
      `${start.part} after four turns`);
  }
});

s.check('a DIP turns in place too', () => {
  const start = U1();
  const was = centreOf(start);
  const now = centreOf(rot.rotatePlacement(start, lib.getPart));
  ok(drift(was, now) <= 0.5, `centre moved ${drift(was, now)} holes`);
});

s.check('an odd-span part turns in place', () => {
  const start = D1();
  const was = centreOf(start);
  const now = centreOf(rot.rotatePlacement(start, lib.getPart));
  ok(drift(was, now) <= 0.5, `centre moved ${drift(was, now)} holes`);
});

s.check('the anchor always lands on a whole hole', () => {
  let pl = D1();
  for (let i = 0; i < 4; i += 1) {
    pl = rot.rotatePlacement(pl, lib.getPart);
    ok(Number.isInteger(pl.at.col) && Number.isInteger(pl.at.row),
      `anchor is integral after ${i + 1} turn(s): ${JSON.stringify(pl.at)}`);
  }
});

s.check('A PART ROTATED IN THE MIDDLE OF A BOARD NEVER LEAVES IT', () => {
  // This is the user-visible fault: half the angles used to throw the part off
  // the edge because it pivoted about pin 1.
  const board = { cols: 25, rows: 20 };
  for (const make of [R1, U1, D1]) {
    let pl = make();
    for (let i = 0; i < 4; i += 1) {
      pl = rot.rotatePlacement(pl, lib.getPart);
      for (const p of rot.resolvePins([pl], lib.getPart)) {
        ok(p.col >= 0 && p.row >= 0 && p.col < board.cols && p.row < board.rows,
          `${pl.part} pin ${p.pin} at (${p.col},${p.row}) after ${i + 1} turn(s)`);
      }
    }
  }
});

s.check('several quarter turns at once match the same number applied singly', () => {
  let stepwise = R1();
  for (let i = 0; i < 3; i += 1) stepwise = rot.rotatePlacement(stepwise, lib.getPart);
  const atOnce = rot.rotatePlacement(R1(), lib.getPart, 3);
  eq({ at: atOnce.at, rot: atOnce.rot }, { at: stepwise.at, rot: stepwise.rot }, '3 turns');
});

s.check('a part with a single pin is unmoved by rotation', () => {
  const mh = { ref: 'MH1', part: 'mount-hole', at: { col: 4, row: 4 }, rot: 0 };
  const after = rot.rotatePlacement(mh, lib.getPart);
  eq(after.at, mh.at, 'a one-pin part has nothing to swing');
});

process.exit((await s.run()) ? 0 : 1);
