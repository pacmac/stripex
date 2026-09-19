// The design rule checks are a LIST of named rules, not one long function.
// Governed by docs/specs/drc-as-a-list-of-rules.md
//
// The point of the list is that a new check — netlist conformance, an accepted
// finding — is a new entry rather than another branch inside the one function
// every other check lives in.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const D = await softImport('../../src/net/drc.js', here);
const lib = await softImport('../../src/parts/library.js', here);

const s = suite('drc-rules');

// A board that trips nine of the ten rules at once: a ref used twice, a socket
// hanging off the top edge, two leads in one hole, a wire between two holes
// already joined, parts shorted out along their strip, the breaks a DIP needs
// missing, two bodies in one place, parts lying along the strips instead of
// across them, and strips carrying nothing.
const BOARD = { cols: 10, rows: 6, pattern: 'strip' };
const PLACEMENTS = [
  { ref: 'R1', part: 'res-axial', span: 3, at: { col: 1, row: 1 }, rot: 0 },
  { ref: 'R1', part: 'res-axial', span: 3, at: { col: 1, row: 3 }, rot: 0 },
  { ref: 'U1', part: 'dip', span: 4, width: 3, at: { col: 4, row: 1 }, rot: 0 },
  { ref: 'D1', part: 'diode', span: 2, at: { col: 0, row: 5 }, rot: 0 },
];
const WIRES = [{ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 9, row: 0 } }];
const BREAKS = [{ row: 2, x: 3, at: 'hole' }];

// What drc() said about that board BEFORE the rules were pulled apart. The
// refactor is only honest if every one of these comes back unchanged.
const BASELINE = [
  ['error', 'duplicate-ref', 'R1 is used by 2 items', 'R1'],
  ['error', 'pin-off-board', 'U1 pin 5 is at (7,-2), outside the 10x6 board', 'U1'],
  ['error', 'pin-off-board', 'U1 pin 6 is at (6,-2), outside the 10x6 board', 'U1'],
  ['error', 'pin-off-board', 'U1 pin 7 is at (5,-2), outside the 10x6 board', 'U1'],
  ['error', 'pin-off-board', 'U1 pin 8 is at (4,-2), outside the 10x6 board', 'U1'],
  ['error', 'hole-collision', 'R1.2 and U1.1 both occupy hole (4,1)', 'R1+U1'],
  ['warning', 'wire-redundant', 'W1 joins two holes already on the same strip segment', 'W1'],
  ['error', 'short-across-part', 'R1 has 1 and 2 on the same strip segment — the part is shorted out', 'R1'],
  ['error', 'short-across-part', 'R1 has 1 and 2 on the same strip segment — the part is shorted out', 'R1'],
  ['error', 'short-across-part', 'R1 has 1 and 2 on the same strip segment — the part is shorted out', 'R1'],
  ['error', 'short-across-part', 'R1 has 1 and 2 on the same strip segment — the part is shorted out', 'R1'],
  ['error', 'missing-required-break', 'U1 needs the strip in row 1 cut between holes 4 and 5', 'U1'],
  ['error', 'missing-required-break', 'U1 needs the strip in row 1 cut between holes 5 and 6', 'U1'],
  ['error', 'missing-required-break', 'U1 needs the strip in row 1 cut between holes 6 and 7', 'U1'],
  ['error', 'short-across-part', 'D1 has A and K on the same strip segment — the part is shorted out', 'D1'],
  ['error', 'bodies-overlap', 'R1 and R1 are both on the top over rows 1-3, holes 1-4 — only one of them can be there', 'R1+R1'],
  ['error', 'bodies-overlap', 'R1 and U1 are both on the top over row 1, hole 4 — only one of them can be there', 'R1+U1'],
  ['error', 'bodies-overlap', 'R1 and U1 are both on the top over row 1, hole 4 — only one of them can be there', 'R1+U1'],
  ['warning', 'pins-against-strips', 'R1 has pins 1 and 2 on one strip, but its pins go across the strips — turn it a quarter turn', 'R1'],
  ['warning', 'pins-against-strips', 'R1 has pins 1 and 2 on one strip, but its pins go across the strips — turn it a quarter turn', 'R1'],
  ['warning', 'pins-against-strips', 'U1 has pins 1 and 2 on one strip, but its pins go across the strips — turn it a quarter turn', 'U1'],
  ['warning', 'pins-against-strips', 'D1 has pins A and K on one strip, but its pins go across the strips — turn it a quarter turn', 'D1'],
  ['info', 'segment-unused', 'row 2 holes 0-2 carries nothing', ''],
  ['info', 'segment-unused', 'row 2 holes 4-9 carries nothing', ''],
  ['info', 'segment-unused', 'row 4 holes 0-9 carries nothing', ''],
];

const flat = (findings) => findings.map((f) => [f.severity, f.code, f.message, (f.refs ?? []).join('+')]);

s.check('THE RULES ARE A LIST OF NAMED FUNCTIONS', () => {
  ok(Array.isArray(D.RULES), 'drc.js exports RULES as a list');
  if (!Array.isArray(D.RULES)) return;
  ok(D.RULES.length >= 9, `at least nine rules: ${D.RULES.length}`);
  eq(D.RULES.filter((r) => typeof r?.run === 'function' && typeof r?.name === 'string').length,
    D.RULES.length, 'every rule has a name and a run');
  eq(new Set(D.RULES.map((r) => r.name)).size, D.RULES.length, 'the names are unique');
});

s.check('THE SAME BOARD STILL PRODUCES EXACTLY THE SAME FINDINGS', () => {
  eq(flat(D.drc(BOARD, BREAKS, PLACEMENTS, lib.getPart, WIRES)), BASELINE,
    'every finding, in order, as before the rules were pulled apart');
});

s.check('ONE RULE CAN BE RUN ON ITS OWN', () => {
  if (!Array.isArray(D.RULES) || typeof D.drcContext !== 'function') {
    ok(false, 'drcContext builds the context a single rule needs');
    return;
  }
  const ctx = D.drcContext(BOARD, BREAKS, PLACEMENTS, lib.getPart, WIRES);
  const rule = D.RULES.find((r) => r.name === 'duplicate-refs');
  ok(rule, 'the duplicate-refs rule is in the list');
  if (!rule) return;
  eq(flat(rule.run(ctx)), [['error', 'duplicate-ref', 'R1 is used by 2 items', 'R1']],
    'run alone it gives its own finding and nothing else');
});

process.exit((await s.run()) ? 0 : 1);
