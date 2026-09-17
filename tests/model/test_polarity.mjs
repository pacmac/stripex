// A polarised part the wrong way round, judged by its nets' names.
// Governed by docs/specs/polarity-by-net-name.md

import { suite, eq, softImport } from '../run.mjs';

const here = import.meta.url;
const rules = await softImport('../../src/model/rules.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('polarity');

// A part standing across the strips at column 5: its first pin on row 2, its
// second on row 2 + span. Row 2 and row 6 carry the names given.
const board = (part, span, top, bottom) => {
  const p = boardm.makeProject({ cols: 12, rows: 10 });
  p.placements = [{ ref: 'X1', part, span, at: { col: 5, row: 2 }, rot: 90 }];
  if (part === 'led') p.placements[0] = { ref: 'X1', part, at: { col: 5, row: 2 }, rot: 90 };
  const bottomRow = part === 'led' ? 3 : 2 + span;
  p.netLabels = {};
  if (top) p.netLabels['0,2'] = { name: top };
  if (bottom) p.netLabels[`0,${bottomRow}`] = { name: bottom };
  return p;
};
const reversed = (p) => rules.checkRules(p).filter((f) => f.code === 'polarity-reversed');

s.check('AN LED WITH ITS ANODE ON 0V WARNS; THE RIGHT WAY ROUND IT DOES NOT', () => {
  const f = reversed(board('led', null, '0V', 'SIG'));
  eq(f.length, 1, `one warning: ${JSON.stringify(f.map((x) => x.message))}`);
  eq(f[0]?.severity, 'warning', 'a warning');
  eq(reversed(board('led', null, 'SIG', '0V')).length, 0, 'anode on a signal, cathode on 0V: fine');
});

s.check('AN ELECTROLYTIC WITH - ON VCC WARNS; + ON +5V AND - ON GND DOES NOT', () => {
  eq(reversed(board('cap-electro', 4, 'SIG', 'VCC')).length, 1, '- on VCC warns');
  eq(reversed(board('cap-electro', 4, '+5V', 'GND')).length, 0, '+ on +5V, - on GND is right');
});

s.check('A DIODE: CATHODE ON GND IS FINE, ANODE ON GND WARNS', () => {
  eq(reversed(board('diode', 4, 'SIG', 'GND')).length, 0, 'cathode on GND');
  eq(reversed(board('diode', 4, 'GND', 'SIG')).length, 1, 'anode on GND');
});

s.check('UNNAMED NETS ARE SILENT', () => {
  eq(reversed(board('led', null, null, null)).length, 0, 'nothing to judge by');
});

process.exit((await s.run()) ? 0 : 1);
