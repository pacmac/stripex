// Checks that packages which cannot work without a cut supply their own,
// and that a DIL has a width as well as a pin count.
// Governed by docs/specs/cuts-and-mounting.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const brk = await softImport('../../src/model/breaks.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const lib = await softImport('../../src/parts/library.js', here);
const drcm = await softImport('../../src/net/drc.js', here);

const s = suite('auto-breaks');

const B = { cols: 25, rows: 20, pattern: 'strip' };

// A DIL straddling the strips: rot 90 puts the two pin rows on two columns, so
// pin n and its opposite pin land on the same row, hence the same strip.
const dip = (span, width, at = { col: 10, row: 5 }) =>
  ({ ref: 'U1', part: 'dip', span, width, at, rot: 90 });

// ------------------------------------------------------------- DIL width

s.check('A DIL WIDTH IS A PARAMETER, NOT A CONSTANT', () => {
  const p = lib.getPart('dip');
  eq(p.defaultWidth, 3, 'default is the 0.3 inch package');
  ok(p.widthLabel, 'it has a label for the editor');
});

s.check('an absent width still means 0.3 inch', () => {
  const pins = rot.resolvePins([{ ...dip(7, undefined), rot: 0 }], lib.getPart);
  const rows = [...new Set(pins.map((p) => p.row))].sort((a, b) => a - b);
  eq(rows[1] - rows[0], 3, 'rows three holes apart');
});

s.check('A 0.6 INCH DIL PUTS ITS ROWS SIX HOLES APART', () => {
  const pins = rot.resolvePins([{ ...dip(8, 6), rot: 0 }], lib.getPart);
  const rows = [...new Set(pins.map((p) => p.row))].sort((a, b) => a - b);
  eq(rows[1] - rows[0], 6, 'rows six holes apart');
  eq(pins.length, 16, 'sixteen pins');
});

s.check('a 0.4 inch DIL works too', () => {
  const pins = rot.resolvePins([{ ...dip(6, 4), rot: 0 }], lib.getPart);
  const rows = [...new Set(pins.map((p) => p.row))].sort((a, b) => a - b);
  eq(rows[1] - rows[0], 4, 'rows four holes apart');
});

s.check('pin 1 and the last pin stay opposite each other at any width', () => {
  for (const width of [3, 4, 6]) {
    const pins = rot.resolvePins([{ ...dip(7, width), rot: 0 }], lib.getPart);
    const p1 = pins.find((p) => p.pin === '1');
    const p14 = pins.find((p) => p.pin === '14');
    eq(p1.col, p14.col, `width ${width}: pin 1 and 14 share a column`);
    // Negative because the second row sits at -width, which is what puts pin 1
    // top-left once the package is turned to straddle the strips.
    eq(Math.abs(p14.row - p1.row), width, `width ${width}: and are ${width} apart`);
  }
});

// ---------------------------------------------------------- required breaks

s.check('a DIP-14 across the strips needs one cut per strip it covers', () => {
  const need = brk.requiredBreaks(dip(7, 3), lib.getPart);
  eq(need.length, 7, 'seven cuts for a fourteen-pin package');
  eq(new Set(need.map((b) => b.row)).size, 7, 'one per row, no duplicates');
});

s.check('EVERY CUT LIES STRICTLY BETWEEN THE PINS IT SEPARATES', () => {
  for (const width of [3, 4, 6]) {
    const pl = dip(7, width);
    const need = brk.requiredBreaks(pl, lib.getPart);
    const pins = rot.resolvePins([pl], lib.getPart);
    for (const b of need) {
      const cols = pins.filter((p) => p.row === b.row).map((p) => p.col).sort((x, y) => x - y);
      ok(b.x >= cols[0] && b.x < cols[cols.length - 1],
        `width ${width}: cut at ${b.x} must satisfy ${cols[0]} <= x < ${cols[cols.length - 1]}`);
    }
  }
});

s.check('a straddling DIL is spot-faced, not knifed', () => {
  // Changed deliberately on 2026-08-30: a DIL declares breakType 'spot-face',
  // because there are holes between its two pin rows and you drill one out
  // rather than getting a knife under the chip. See docs/specs/device-break-type.md.
  // The detail lives in tests/parts/test_break_type.mjs; this only guards the
  // shape of what requiredBreaks emits.
  for (const b of brk.requiredBreaks(dip(7, 3), lib.getPart)) {
    eq(b.at, 'hole', 'at');
  }
});

s.check('A WIDE DIL STILL NEEDS EXACTLY ONE CUT PER ROW', () => {
  const need = brk.requiredBreaks(dip(8, 6), lib.getPart);
  eq(need.length, 8, 'eight rows, eight cuts');
  eq(new Set(need.map((b) => b.row)).size, 8, 'one each');
});

s.check('THE CUTS ACTUALLY CLEAR THE SHORTS THEY EXIST FOR', () => {
  const pl = dip(7, 3);
  const before = drcm.drc(B, [], [pl], lib.getPart, [])
    .filter((f) => f.severity === 'error');
  ok(before.length > 0, `an uncut DIL is shorted (${before.length} errors)`);
  const after = drcm.drc(B, brk.requiredBreaks(pl, lib.getPart), [pl], lib.getPart, [])
    .filter((f) => f.severity === 'error');
  eq(after, [], 'and with its cuts it is clean');
});

s.check('a wide DIL is clean once cut, too', () => {
  const pl = dip(8, 6);
  const after = drcm.drc(B, brk.requiredBreaks(pl, lib.getPart), [pl], lib.getPart, [])
    .filter((f) => f.severity === 'error');
  eq(after, [], 'no errors');
});

s.check('an 0603 needs exactly one cut, between its two poles', () => {
  const chip = { ref: 'C1', part: 'smt-0603', at: { col: 6, row: 2 }, rot: 0 };
  const need = brk.requiredBreaks(chip, lib.getPart);
  eq(need.length, 1, 'one cut');
  eq([need[0].row, need[0].x, need[0].at], [2, 6, 'gap'], 'between holes 6 and 7 of row 2');
});

s.check('a part that needs no cut asks for none', () => {
  const r = { ref: 'R1', part: 'res-axial', span: 4, at: { col: 2, row: 2 }, rot: 90 };
  eq(brk.requiredBreaks(r, lib.getPart), [], 'a resistor across strips needs nothing');
});

s.check('a resistor lying ALONG a strip is shorted but is not a requiresBreak part', () => {
  // It still needs a cut to work, but that is the user's mistake to see reported
  // as a short — not a package whose datasheet demands one.
  const r = { ref: 'R1', part: 'res-axial', span: 4, at: { col: 2, row: 2 }, rot: 0 };
  eq(brk.requiredBreaks(r, lib.getPart), [], 'not auto-cut');
  const codes = drcm.drc(B, [], [r], lib.getPart, []).map((f) => f.code);
  ok(codes.includes('short-across-part'), 'reported as a plain short');
});

s.check('requiredBreaks does not mutate the placement', () => {
  const pl = dip(7, 3);
  const snapshot = JSON.stringify(pl);
  brk.requiredBreaks(pl, lib.getPart);
  eq(JSON.stringify(pl), snapshot, 'unchanged');
});

s.check('mergeBreaks adds only the cuts not already there', () => {
  const pl = dip(7, 3);
  const need = brk.requiredBreaks(pl, lib.getPart);
  const existing = [need[0], { row: 19, x: 1, at: 'gap' }];
  const merged = brk.mergeBreaks(existing, need);
  eq(merged.length, 1 + need.length, 'no duplicate of the one already present');
});

process.exit((await s.run()) ? 0 : 1);
