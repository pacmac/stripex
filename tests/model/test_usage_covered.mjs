// A column under a package is covered, not empty.
// Governed by docs/specs/usage-covered.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const V = await softImport('../../src/model/views.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('usage-covered');

const board = () => {
  const p = boardm.makeProject({ cols: 16, rows: 10 });
  p.placements = [
    // rot 90, width 3: pins in columns 5 and 8, rows 2-5.
    { ref: 'U1', part: 'dip', span: 4, width: 3, at: { col: 5, row: 2 }, rot: 90 },
    // A link lying along row 8 from column 10 to 13.
    { ref: 'L1', part: 'wire-link', span: 3, at: { col: 10, row: 8 }, rot: 0 },
  ];
  return p;
};

s.check('THE COLUMNS BETWEEN A DIP\'S PIN ROWS ARE COVERED, NOT EMPTY', () => {
  const u = V.usageOf(board());
  ok(!u.emptyColumns.includes(6) && !u.emptyColumns.includes(7),
    `6 and 7 are not called empty: ${u.emptyColumns}`);
  const covered = (u.coveredColumns ?? []).filter((c) => c.col === 6 || c.col === 7);
  eq(covered.map((c) => [c.col, c.refs]), [[6, ['U1']], [7, ['U1']]], 'they are covered by U1');
});

s.check('A FREE COLUMN IS STILL EMPTY, AND A LINK COVERS THE COLUMNS IT LIES OVER', () => {
  const u = V.usageOf(board());
  ok(u.emptyColumns.includes(2), `column 2 is empty: ${u.emptyColumns}`);
  ok(!u.emptyColumns.includes(11) && !u.emptyColumns.includes(12), 'columns under the link are not empty');
  eq((u.coveredColumns ?? []).filter((c) => c.col === 11).map((c) => c.refs), [['L1']], 'column 11 is covered by L1');
});

process.exit((await s.run()) ? 0 : 1);
