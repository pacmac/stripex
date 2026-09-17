// Net names that name nothing, and nets with two names: reported, and clearable.
// Governed by docs/specs/stranded-net-labels.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const V = await softImport('../../src/model/views.js', here);
const ops = await softImport('../../src/model/ops.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('stranded-labels');

// R1 stands across rows B and F, so both strips are nets. MS1 sits on row B at
// column 7, and that hole is spot-faced: Peter's MS1, in miniature. Row F
// carries two different names: the 0V/CLK conflict on his board.
const board = () => {
  const p = boardm.makeProject({ cols: 12, rows: 6 });
  p.placements = [{ ref: 'R1', part: 'res-axial', span: 4, at: { col: 3, row: 1 }, rot: 90 }];
  p.breaks = [{ row: 1, x: 6, at: 'hole' }];
  p.netLabels = {
    '6,1': { name: 'MS1' },
    '0,5': { name: '0V' },
    '10,5': { name: 'CLK' },
  };
  return p;
};

s.check('A NAME ON A SPOT-FACED HOLE IS A WARNING NAMING THE NAME AND THE HOLE', () => {
  const f = V.findingsFor(board()).filter((x) => x.code === 'net-name-stranded');
  eq(f.length, 1, `one stranded name: ${JSON.stringify(f)}`);
  if (!f.length) return;
  eq(f[0].severity, 'warning', 'a warning');
  ok(/MS1/.test(f[0].message) && /B7/.test(f[0].message), `names MS1 and B7: "${f[0].message}"`);
  eq(f[0].holes, [{ col: 6, row: 1 }], 'and carries the hole');
});

s.check('A NET WITH TWO NAMES IS A WARNING IN THE FINDINGS', () => {
  const f = V.findingsFor(board()).filter((x) => x.code === 'net-name-conflict');
  eq(f.length, 1, `one conflict: ${JSON.stringify(f)}`);
  ok(f.length && /0V/.test(f[0].message) && /CLK/.test(f[0].message), 'naming both names');
  eq(f[0]?.severity, 'warning', 'as a warning');
});

s.check('setLabel CLEARS A NAME ON A DEAD HOLE, AND STILL WILL NOT SET ONE THERE', () => {
  const cleared = ops.setLabel(board(), { col: 6, row: 1 }, { name: '' });
  eq(cleared.error, undefined, `the clear is let through: ${cleared.error}`);
  eq(cleared.project?.netLabels?.['6,1'], undefined, 'and the name is gone');
  const set = ops.setLabel(board(), { col: 6, row: 1 }, { name: 'X' });
  eq(set.code, 'dead-hole', 'naming a dead hole is still refused');
});

process.exit((await s.run()) ? 0 : 1);
