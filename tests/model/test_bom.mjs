// The tables that print beside the board: bill of materials, cuts, wire runs.
// Governed by docs/specs/print-view.md
//
// Peter, 2026-09-17: "also include option to include table for BOM, and maybe
// others."

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const V = await softImport('../../src/model/views.js', here);
const P = await softImport('../../src/render/print.js', here);
const dev = await softImport('../../src/parts/devices.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('bom');

const board = () => {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.placements = [
    { ref: 'R10', part: 'res-axial', span: 4, at: { col: 2, row: 1 }, rot: 90, value: '10k' },
    { ref: 'R2', part: 'res-axial', span: 4, at: { col: 4, row: 1 }, rot: 90, value: '10k' },
    { ref: 'R1', part: 'res-axial', span: 4, at: { col: 6, row: 1 }, rot: 90, value: '1k' },
    { ...dev.placementFor('sot23-mosfet', { col: 10, row: 2 }, 0, 'Q1'), value: 'AO3401' },
    { ref: 'L1', part: 'wire-link', span: 4, at: { col: 12, row: 1 }, rot: 90 },
    { ref: 'L2', part: 'wire-link', span: 4, at: { col: 13, row: 1 }, rot: 90 },
    { ref: 'L3', part: 'wire-link', span: 2, at: { col: 14, row: 1 }, rot: 90 },
  ];
  p.breaks = [{ row: 2, x: 3, at: 'gap' }, { row: 2, x: 4, at: 'hole' }];
  p.wires = [{ ref: 'A', from: { col: 1, row: 1 }, to: { col: 8, row: 9 } }];
  return p;
};

s.check('ONE ROW PER DISTINCT THING, COUNTED, REFS IN NATURAL ORDER', () => {
  ok(typeof V.bomFor === 'function', 'bomFor exists');
  if (typeof V.bomFor !== 'function') return;
  const rows = V.bomFor(board());
  const find = (pred) => rows.find(pred);
  const tenK = find((r) => r.value === '10k');
  eq(tenK && { qty: tenK.qty, refs: tenK.refs, part: tenK.part },
    { qty: 2, refs: ['R2', 'R10'], part: 'Resistor (axial)' }, 'two 10k resistors, R2 before R10');
  eq(find((r) => r.value === '1k')?.qty, 1, 'the 1k is its own row');
  eq(find((r) => r.refs.includes('Q1'))?.part, 'SOT-23 MOSFET', 'a device is named as the device');
  const links = rows.filter((r) => /Wire link/.test(r.part));
  eq(links.map((r) => [r.part, r.qty]).sort(), [['Wire link, 2 holes', 1], ['Wire link, 4 holes', 2]].sort(),
    'wire links grouped by length');
});

s.check('SOCKETS AND HEADERS OF DIFFERENT SIZES ARE DIFFERENT ROWS', () => {
  // Found printing a copy of Peter's board: his TMC2209 (16 pins) and U1
  // (14 pins) are untagged DIPs, and the BOM said "2 x DIP / IC socket" — which
  // is two wrong sockets bought. A part whose pin count varies names it.
  const p = boardm.makeProject({ cols: 30, rows: 12 });
  p.placements = [
    { ref: 'U1', part: 'dip', span: 7, width: 3, at: { col: 2, row: 5 }, rot: 90 },
    { ref: 'U2', part: 'dip', span: 8, width: 5, at: { col: 10, row: 5 }, rot: 90 },
    { ref: 'U3', part: 'dip', span: 7, width: 3, at: { col: 20, row: 5 }, rot: 90 },
    { ref: 'R1', part: 'res-axial', span: 4, at: { col: 26, row: 1 }, rot: 90 },
  ];
  const rows = V.bomFor(p);
  eq(rows.filter((r) => /DIP/.test(r.part)).map((r) => [r.part, r.qty, r.refs.join(',')]),
    [['DIP / IC socket, 14 pins', 2, 'U1,U3'], ['DIP / IC socket, 16 pins', 1, 'U2']],
    'a 14-pin and a 16-pin socket are separate rows');
  eq(rows.find((r) => r.refs.includes('R1'))?.part, 'Resistor (axial)',
    'a part whose pin count never varies is not given one');
});

s.check('HOLES ARE NAMED BY THE EDGE LABELS: row letter, column number', () => {
  ok(typeof P.holeName === 'function', 'holeName exists');
  if (typeof P.holeName !== 'function') return;
  eq(P.holeName(4, 2), 'C5', 'column index 4, row index 2 is C5');
  eq(P.holeName(0, 26), 'AA1', 'row 27 is AA');
});

s.check('CUTS AND WIRE RUNS IN HOLE NAMES', () => {
  ok(typeof P.cutRows === 'function' && typeof P.wireRows === 'function', 'cutRows and wireRows exist');
  if (typeof P.cutRows !== 'function' || typeof P.wireRows !== 'function') return;
  const where = P.cutRows(board()).map((c) => c.where);
  ok(where.includes('C 4|5'), `a knife cut between columns 4 and 5 on row C: ${where}`);
  ok(where.includes('C5'), `a spot-face at C5: ${where}`);
  eq(P.wireRows(board()).map((w) => [w.ref, w.from, w.to]), [['A', 'B2', 'J9']], 'wire A runs B2 to J9');
});

process.exit((await s.run()) ? 0 : 1);
