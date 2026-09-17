// Two part bodies in the same place on the same side of the board.
// Governed by docs/specs/body-overlap.md
//
// Registered: "a resistor spanning rows 4-9 and a capacitor spanning 6-8 in the
// same column pass the DRC, the rules and the netlist check."

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const drcm = await softImport('../../src/net/drc.js', here);
const lib = await softImport('../../src/parts/library.js', here);

const s = suite('body-overlap');
const B = { cols: 20, rows: 14, pattern: 'strip' };
const codes = (placements) => drcm.drc(B, [], placements, lib.getPart, []);
const overlaps = (placements) => codes(placements).filter((f) => f.code === 'bodies-overlap');

// rot 90: pins run down a column from the anchor.
const R = (ref, col, row, span) => ({ ref, part: 'res-axial', span, at: { col, row }, rot: 90 });

s.check('A RESISTOR OVER ROWS 4-9 AND A CAPACITOR OVER 6-8 IN ONE COLUMN ARE AN ERROR', () => {
  const f = overlaps([R('R1', 5, 4, 5), { ref: 'C1', part: 'cap-ceramic', span: 2, at: { col: 5, row: 6 }, rot: 90 }]);
  eq(f.length, 1, `one overlap: ${JSON.stringify(f.map((x) => x.message))}`);
  eq(f[0]?.severity, 'error', 'as an error');
  eq([...(f[0]?.refs ?? [])].sort(), ['C1', 'R1'], 'naming both parts');
});

s.check('A PART INSIDE A DIP\'S FOOTPRINT IS AN ERROR', () => {
  const dip = { ref: 'U1', part: 'dip', span: 4, width: 3, at: { col: 8, row: 3 }, rot: 90 };
  // A resistor standing in the DIP's middle column, under the package.
  eq(overlaps([dip, R('R1', 9, 3, 3)]).length, 1, 'a resistor under the chip');
});

s.check('WHAT IS NOT AN OVERLAP', () => {
  eq(overlaps([R('R1', 5, 2, 3), R('R2', 5, 6, 3)]).length, 0, 'end to end in one column, not touching');
  eq(overlaps([R('R1', 5, 2, 4), R('R2', 6, 2, 4)]).length, 0, 'side by side in neighbouring columns');
  const dip = { ref: 'U1', part: 'dip', span: 4, width: 3, at: { col: 8, row: 3 }, rot: 90 };
  eq(overlaps([dip, { ref: 'L1', part: 'wire-link', span: 3, at: { col: 9, row: 3 }, rot: 90 }]).length, 0,
    'a wire link under a chip is what links do');
  eq(overlaps([dip, { ref: 'C1', part: 'smt-0603', at: { col: 9, row: 4 }, rot: 90 }]).length, 0,
    'an 0603 on the copper side under a top-side chip');
  eq(overlaps([R('R1', 5, 4, 5), { ...R('R2', 5, 5, 3), side: 'copper' }]).length, 0,
    'two parts on opposite sides of the board');
});

process.exit((await s.run()) ? 0 : 1);
