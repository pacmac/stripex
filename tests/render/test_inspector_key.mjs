// The Focus panel is rebuilt only when its SHAPE changes, never merely because
// a value in it changed — otherwise editing a field destroys the field.
// Governed by docs/specs/inspector-rebuild.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const P = await softImport('../../src/render/panels.js', here);
const lib = await softImport('../../src/parts/library.js', here);

const s = suite('inspector-key');

const sel = (kind, ref) => ({ kind, ref });
const U1 = (over = {}) => ({ ref: 'U1', part: 'dip', span: 7, width: 3,
  at: { col: 5, row: 5 }, rot: 90, ...over });
const key = (selection, target, partId) =>
  P.inspectorKey(selection, target, partId ? lib.getPart(partId) : null);

const kU1 = (over = {}) => key(sel('part', over.ref ?? 'U1'), U1(over), 'dip');

s.check('a null selection has no key', () => {
  eq(P.inspectorKey(null, null, null), null, 'null selection');
});

// ---------------- the whole point: values must not change the key ----------

s.check('CHANGING THE SPAN DOES NOT CHANGE THE KEY', () => {
  eq(kU1({ span: 9 }), kU1(), 'span 7 -> 9');
});

s.check('CHANGING THE WIDTH DOES NOT CHANGE THE KEY', () => {
  eq(kU1({ width: 6 }), kU1(), 'width 3 -> 6');
});

s.check('nor does the value, the rotation or the position', () => {
  eq(kU1({ value: 'LM358' }), kU1(), 'value');
  eq(kU1({ rot: 180 }), kU1(), 'rotation');
  eq(kU1({ at: { col: 12, row: 2 } }), kU1(), 'position');
});

s.check('every value at once still leaves the key alone', () => {
  eq(kU1({ span: 8, width: 6, rot: 270, value: 'x', at: { col: 1, row: 1 } }), kU1(),
    'all values changed');
});

// ------------------- and the shape must change the key ---------------------

s.check('selecting a different part changes the key', () => {
  ok(kU1() !== key(sel('part', 'U2'), U1({ ref: 'U2' }), 'dip'), 'U1 vs U2');
});

s.check('renaming changes the key, because the handlers point at the old ref', () => {
  ok(kU1() !== kU1({ ref: 'IC3' }), 'U1 vs IC3');
});

s.check('A DIFFERENT PART TYPE CHANGES THE KEY', () => {
  // A resistor offers no width field, so the panel really is a different shape.
  const r = { ref: 'U1', part: 'res-axial', span: 4, at: { col: 5, row: 5 }, rot: 0 };
  ok(kU1() !== key(sel('part', 'U1'), r, 'res-axial'), 'dip vs resistor');
});

s.check('a part with no span offers fewer fields, so a different key again', () => {
  const led = { ref: 'U1', part: 'led', at: { col: 5, row: 5 }, rot: 0 };
  const res = { ref: 'U1', part: 'res-axial', span: 4, at: { col: 5, row: 5 }, rot: 0 };
  ok(key(sel('part', 'U1'), led, 'led') !== key(sel('part', 'U1'), res, 'res-axial'),
    'led vs resistor');
});

s.check('a wire and a part with the same ref do not collide', () => {
  const w = { ref: 'U1', from: { col: 0, row: 0 }, to: { col: 3, row: 3 } };
  ok(kU1() !== P.inspectorKey(sel('wire', 'U1'), w, null), 'part vs wire');
});

s.check('a break has its own key, stable across nothing changing', () => {
  const a = P.inspectorKey(sel('break', '3,5'), null, null);
  const b = P.inspectorKey(sel('break', '3,5'), null, null);
  ok(a, 'a break has a key');
  eq(a, b, 'and it is stable');
  ok(a !== P.inspectorKey(sel('break', '4,5'), null, null), 'a different break differs');
});

s.check('moving a wire end does not change its key', () => {
  const w = (to) => ({ ref: 'W1', from: { col: 0, row: 0 }, to });
  eq(P.inspectorKey(sel('wire', 'W1'), w({ col: 9, row: 9 }), null),
    P.inspectorKey(sel('wire', 'W1'), w({ col: 3, row: 3 }), null), 'wire end moved');
});

s.check('the key is a string, so it can be compared cheaply', () => {
  eq(typeof kU1(), 'string', 'type');
});

s.check('a selection whose target has gone still yields a key', () => {
  // The panel has to render "Gone." rather than throw.
  ok(P.inspectorKey(sel('part', 'NOPE'), null, null), 'missing target');
});

process.exit((await s.run()) ? 0 : 1);
