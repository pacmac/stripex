// Every part must carry its own reference designator prefix.
// Governed by docs/specs/cuts-and-mounting.md
//
// The prefix used to live in a lookup table in board.js — a second list of every
// part, which has to be kept in step with the library and was not: the 0603 was
// added to the library and came out of the editor named "X1". A list that must
// agree with another list, with nothing checking it, is the defect. This file is
// the check.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const lib = await softImport('../../src/parts/library.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('ref-prefixes');

s.check('EVERY PART IN THE LIBRARY DECLARES A REF PREFIX', () => {
  const missing = Object.values(lib.PARTS)
    .filter((p) => !p.refPrefix)
    .map((p) => p.id);
  eq(missing, [], 'parts with no refPrefix');
});

s.check('prefixes are the conventional letters', () => {
  const want = {
    'res-axial': 'R', diode: 'D', 'cap-ceramic': 'C', 'cap-electro': 'C',
    led: 'LED', to92: 'Q', to220: 'Q', dip: 'U', header: 'J',
    'mount-hole': 'MH', 'wire-link': 'L', 'smt-0603': 'R', 'smt-0603-cap': 'C',
  };
  for (const [id, prefix] of Object.entries(want)) {
    ok(lib.hasPart(id), `${id} exists`);
    eq(lib.getPart(id).refPrefix, prefix, `${id} prefix`);
  }
});

s.check('NO PART FALLS BACK TO X', () => {
  const empty = boardm.makeProject({ cols: 10, rows: 10 });
  const xs = Object.keys(lib.PARTS)
    .filter((id) => boardm.nextPartRef(empty, id).startsWith('X'));
  eq(xs, [], 'parts named X1');
});

s.check('an 0603 resistor is R1 and an 0603 capacitor is C1', () => {
  const empty = boardm.makeProject({ cols: 10, rows: 10 });
  eq(boardm.nextPartRef(empty, 'smt-0603'), 'R1', 'smt resistor');
  eq(boardm.nextPartRef(empty, 'smt-0603-cap'), 'C1', 'smt capacitor');
});

s.check('refs still count up past the ones in use', () => {
  const p = boardm.makeProject({ cols: 10, rows: 10 });
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 2, at: { col: 0, row: 0 }, rot: 0 });
  p.placements.push({ ref: 'R2', part: 'smt-0603', at: { col: 4, row: 4 }, rot: 0 });
  eq(boardm.nextPartRef(p, 'res-axial'), 'R3', 'next free R');
});

s.check('an unknown part still gets a usable ref rather than throwing', () => {
  const empty = boardm.makeProject({ cols: 10, rows: 10 });
  ok(boardm.nextPartRef(empty, 'no-such-part'), 'a ref came back');
});

process.exit((await s.run()) ? 0 : 1);
