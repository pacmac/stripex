// A DIL's automatic cuts can be switched off, so you can cut the strips
// under it yourself.
// Governed by docs/specs/wire-colour-by-length.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const brk = await softImport('../../src/model/breaks.js', here);
const lib = await softImport('../../src/parts/library.js', here);
const E = await softImport('../../src/model/edit.js', here);
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('autobreak-switch');

const dil = (over = {}) => ({ ref: 'U1', part: 'dip', span: 7, width: 3,
  at: { col: 10, row: 4 }, rot: 90, ...over });

const project = (pl) => {
  const p = boardm.makeProject({ cols: 25, rows: 20 });
  p.placements.push(pl);
  return p;
};

s.check('a DIL cuts its own strips by default, as before', () => {
  eq(brk.requiredBreaks(dil(), lib.getPart).length, 7, 'seven cuts');
  eq(brk.effectiveBreaks(project(dil())).length, 7, 'and they reach the board');
});

s.check('AUTOBREAK FALSE DERIVES NO CUTS AT ALL', () => {
  eq(brk.requiredBreaks(dil({ autoBreak: false }), lib.getPart), [], 'none required');
  eq(brk.effectiveBreaks(project(dil({ autoBreak: false }))), [], 'none on the board');
});

s.check('autoBreak true is the same as leaving it out', () => {
  eq(brk.requiredBreaks(dil({ autoBreak: true }), lib.getPart).length,
    brk.requiredBreaks(dil(), lib.getPart).length, 'same count');
});

s.check('WITH THE CUTS OFF, THE DRC REPORTS THE SHORTS', () => {
  // The point of switching them off is to cut the strips yourself. Until you do,
  // the package really is shorted pin to pin and the tool must say so.
  const errors = R.findingsFor(project(dil({ autoBreak: false })))
    .filter((f) => f.severity === 'error');
  ok(errors.length > 0, `shorted with no cuts (${errors.length} errors)`);
  ok(errors.every((f) => f.code === 'missing-required-break'),
    'and each names the cut to make');
});

s.check('...and cutting them by hand clears the errors', () => {
  const p = project(dil({ autoBreak: false }));
  // The user makes the same cuts, their own way — a knife rather than a drill.
  for (const b of brk.requiredBreaks(dil(), lib.getPart)) {
    p.breaks.push({ row: b.row, x: b.x, at: 'gap' });
  }
  eq(R.findingsFor(p).filter((f) => f.severity === 'error'), [], 'clean');
});

s.check('a hand cut in a different place is honoured, not overruled', () => {
  const p = project(dil({ autoBreak: false }));
  const pins = brk.requiredBreaks(dil(), lib.getPart);
  // one gap to the left of where the tool would have drilled
  for (const b of pins) p.breaks.push({ row: b.row, x: b.x - 1, at: 'gap' });
  eq(R.findingsFor(p).filter((f) => f.severity === 'error'), [], 'clean');
  eq(brk.effectiveBreaks(p).length, pins.length, 'only the user cuts');
});

s.check('turning them back on restores them', () => {
  const p = project(dil({ autoBreak: false }));
  eq(brk.effectiveBreaks(p).length, 0, 'off');
  p.placements[0].autoBreak = true;
  eq(brk.effectiveBreaks(p).length, 7, 'on again');
});

s.check('a part that never had automatic cuts is unaffected', () => {
  const r = { ref: 'R1', part: 'res-axial', span: 4, at: { col: 2, row: 2 }, rot: 90 };
  eq(brk.requiredBreaks({ ...r, autoBreak: false }, lib.getPart), [], 'none either way');
});

s.check('AUTOBREAK IS AN EDITABLE FIELD ON PARTS THAT CUT', () => {
  ok(E.editableFields(lib.getPart('dip')).includes('autoBreak'), 'a DIL offers it');
  ok(!E.editableFields(lib.getPart('res-axial')).includes('autoBreak'),
    'a resistor does not, because it has no cuts to switch');
});

s.check('the edit applies and is a real boolean', () => {
  const { placement, error } = E.applyPlacementEdit(dil(), lib.getPart, 'autoBreak', false);
  ok(!error, 'accepted');
  eq(placement.autoBreak, false, 'stored as false');
  eq(E.applyPlacementEdit(dil(), lib.getPart, 'autoBreak', true).placement.autoBreak, true,
    'and true');
});

s.check('the derived cuts still name their owner when they are on', () => {
  for (const b of brk.effectiveBreaks(project(dil()))) eq(b.owner, 'U1', 'owner');
});

process.exit((await s.run()) ? 0 : 1);
