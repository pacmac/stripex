// A device says how its strips are cut: knife, or spot-face.
// Governed by docs/specs/device-break-type.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const lib = await softImport('../../src/parts/library.js', here);
const brk = await softImport('../../src/model/breaks.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const drcm = await softImport('../../src/net/drc.js', here);

const s = suite('break-type');

const B = { cols: 25, rows: 20, pattern: 'strip' };

// rot 90 straddles the strips: the two pin rows land on two columns, so the pins
// sharing a row are `width` holes apart and a hole sits between them.
const dilStraddling = (width = 3) =>
  ({ ref: 'U1', part: 'dip', span: 7, width, at: { col: 9, row: 4 }, rot: 90 });

// rot 0 lies along the strips: seven pins in a row, adjacent, no hole between.
const dilAlong = (width = 3) =>
  ({ ref: 'U1', part: 'dip', span: 7, width, at: { col: 9, row: 4 }, rot: 0 });

const chip = () => ({ ref: 'R1', part: 'smt-0603', at: { col: 6, row: 2 }, rot: 0 });

// ------------------------------------------------------------- declarations

s.check('A DIL DECLARES SPOT-FACE', () => {
  eq(lib.getPart('dip').breakType, 'spot-face', 'dip breakType');
});

s.check('the 0603s declare knife — their pads are adjacent', () => {
  eq(lib.getPart('smt-0603').breakType, 'knife', 'smt resistor');
  eq(lib.getPart('smt-0603-cap').breakType, 'knife', 'smt capacitor');
});

s.check('a part that declares nothing counts as knife', () => {
  eq(lib.breakTypeOf(lib.getPart('res-axial')), 'knife', 'default');
});

// ------------------------------------------------------------------- cutting

s.check('A STRADDLING DIL IS SPOT-FACED, NOT KNIFED', () => {
  const cuts = brk.requiredBreaks(dilStraddling(3), lib.getPart);
  ok(cuts.length > 0, 'it needs cuts');
  for (const c of cuts) eq(c.at, 'hole', `cut in row ${c.row}`);
});

s.check('each spot-face sits strictly between the pins it separates', () => {
  for (const width of [3, 4, 6]) {
    const pl = dilStraddling(width);
    const pins = rot.resolvePins([pl], lib.getPart);
    for (const c of brk.requiredBreaks(pl, lib.getPart)) {
      const cols = pins.filter((p) => p.row === c.row).map((p) => p.col).sort((x, y) => x - y);
      ok(c.x > cols[0] && c.x < cols[cols.length - 1],
        `width ${width}: hole ${c.x} must be strictly inside ${cols[0]}..${cols[cols.length - 1]}`);
    }
  }
});

s.check('a 0.3 inch DIL at columns 6 and 9 is drilled at hole 7', () => {
  const cuts = brk.requiredBreaks(dilStraddling(3), lib.getPart);
  const pins = rot.resolvePins([dilStraddling(3)], lib.getPart);
  const row = cuts[0].row;
  const cols = pins.filter((p) => p.row === row).map((p) => p.col).sort((a, b) => a - b);
  eq(cuts[0].x, Math.floor((cols[0] + cols[1]) / 2), 'midway hole');
});

s.check('A SPOT-FACE DEVICE FALLS BACK TO A KNIFE WHEN ITS PINS ARE ADJACENT', () => {
  // The same DIL turned along the strips has seven pins in a row with no hole
  // between any pair. A spot-face is physically impossible there, and drilling
  // at a pin would take out a hole with a leg in it.
  const cuts = brk.requiredBreaks(dilAlong(3), lib.getPart);
  ok(cuts.length > 0, 'it still needs cuts');
  for (const c of cuts) eq(c.at, 'gap', `cut in row ${c.row}`);
});

s.check('an 0603 is a knife cut whichever way round it is', () => {
  for (const r of [0, 90, 180, 270]) {
    const cuts = brk.requiredBreaks({ ...chip(), rot: r }, lib.getPart);
    for (const c of cuts) eq(c.at, 'gap', `rot ${r}`);
  }
});

s.check('an 0603 lying across two strips needs no cut at all', () => {
  eq(brk.requiredBreaks({ ...chip(), rot: 90 }, lib.getPart), [], 'no cuts across strips');
});

// -------------------------------------------------------- it must still work

s.check('THE SPOT-FACES ACTUALLY CLEAR THE SHORTS', () => {
  for (const width of [3, 4, 6]) {
    const pl = dilStraddling(width);
    const before = drcm.drc(B, [], [pl], lib.getPart, [])
      .filter((f) => f.severity === 'error');
    ok(before.length > 0, `width ${width}: uncut DIL is shorted`);
    const after = drcm.drc(B, brk.requiredBreaks(pl, lib.getPart), [pl], lib.getPart, [])
      .filter((f) => f.severity === 'error');
    eq(after, [], `width ${width}: clean once spot-faced`);
  }
});

s.check('and so do the knife cuts in the fallback orientation', () => {
  const pl = dilAlong(3);
  const after = drcm.drc(B, brk.requiredBreaks(pl, lib.getPart), [pl], lib.getPart, [])
    .filter((f) => f.severity === 'error');
  eq(after, [], 'no errors');
});

s.check('a spot-faced hole is dead, and nothing is soldered there', () => {
  // The drilled hole must not be one the package occupies.
  const pl = dilStraddling(3);
  const pinHoles = new Set(rot.resolvePins([pl], lib.getPart).map((p) => `${p.col},${p.row}`));
  for (const c of brk.requiredBreaks(pl, lib.getPart)) {
    ok(!pinHoles.has(`${c.x},${c.row}`), `hole ${c.x},${c.row} carries no pin`);
  }
});

s.check('a DIL in a project ends up with hole cuts on the real board', () => {
  const p = { schema: 'stripex/1', board: B, breaks: [], wires: [],
    placements: [dilStraddling(3)] };
  const cuts = brk.effectiveBreaks(p);
  eq(cuts.length, 7, 'seven cuts');
  for (const c of cuts) eq(c.at, 'hole', 'each is a spot-face');
});

process.exit((await s.run()) ? 0 : 1);
