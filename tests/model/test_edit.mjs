// Editing a selected part's fields.
// Governed by docs/specs/editable-selection.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const E = await softImport('../../src/model/edit.js', here);
const lib = await softImport('../../src/parts/library.js', here);
const rot = await softImport('../../src/model/rotate.js', here);

const s = suite('edit');

const R1 = () => ({ ref: 'R1', part: 'res-axial', span: 4,
  at: { col: 5, row: 5 }, rot: 0, value: '10k' });
const U1 = () => ({ ref: 'U1', part: 'dip', span: 7, width: 3,
  at: { col: 5, row: 5 }, rot: 90 });

const apply = (pl, field, value) => E.applyPlacementEdit(pl, lib.getPart, field, value);

// ------------------------------------------------------------ what is offered

s.check('a DIL offers width, a resistor does not', () => {
  ok(E.editableFields(lib.getPart('dip')).includes('width'), 'dip has width');
  ok(!E.editableFields(lib.getPart('res-axial')).includes('width'), 'resistor has none');
});

s.check('a fixed-geometry part offers no span', () => {
  ok(!E.editableFields(lib.getPart('led')).includes('span'), 'LED has no span');
  ok(E.editableFields(lib.getPart('res-axial')).includes('span'), 'resistor has span');
});

s.check('every part offers ref, value, rotation and position', () => {
  for (const id of ['res-axial', 'dip', 'led', 'smt-0603']) {
    const f = E.editableFields(lib.getPart(id));
    for (const want of ['ref', 'value', 'rot', 'col', 'row']) {
      ok(f.includes(want), `${id} offers ${want}`);
    }
  }
});

// --------------------------------------------------------------- applying

s.check('the ref can be changed', () => {
  const { placement, error } = apply(R1(), 'ref', 'R7');
  ok(!error, 'no error');
  eq(placement.ref, 'R7', 'ref');
});

s.check('the value can be changed, and cleared', () => {
  eq(apply(R1(), 'value', '4k7').placement.value, '4k7', 'set');
  eq(apply(R1(), 'value', '').placement.value, '', 'cleared');
});

s.check('the span can be changed', () => {
  eq(apply(R1(), 'span', 6).placement.span, 6, 'span');
});

s.check('A DIP-14 CAN BE MADE A DIP-16 WITHOUT REPLACING IT', () => {
  const { placement, error } = apply(U1(), 'span', 8);
  ok(!error, 'no error');
  eq(placement.span, 8, 'span');
  eq(rot.resolvePins([placement], lib.getPart).length, 16, 'sixteen pins');
  eq(placement.ref, 'U1', 'and it kept its ref');
});

s.check('A 0.3 INCH PACKAGE CAN BE MADE 0.6 INCH', () => {
  const { placement } = apply(U1(), 'width', 6);
  eq(placement.width, 6, 'width');
  const pins = rot.resolvePins([{ ...placement, rot: 0 }], lib.getPart);
  const rows = [...new Set(pins.map((p) => p.row))].sort((a, b) => a - b);
  eq(rows[1] - rows[0], 6, 'rows six holes apart');
});

s.check('the position can be typed', () => {
  eq(apply(R1(), 'col', 9).placement.at, { col: 9, row: 5 }, 'col');
  eq(apply(R1(), 'row', 2).placement.at, { col: 5, row: 2 }, 'row');
});

s.check('ROTATION FROM THE PANEL TURNS THE PART IN PLACE', () => {
  // Must behave exactly as the Rotate button: about its own centre, not
  // swinging round pin 1.
  // U1 starts at 90, so setting 180 is ONE quarter turn, and setting 0 is three.
  const start = U1();
  const once = apply(start, 'rot', 180).placement;
  const viaButton = rot.rotatePlacement(start, lib.getPart);
  eq({ at: once.at, rot: once.rot }, { at: viaButton.at, rot: viaButton.rot },
    'one quarter: panel and button agree');

  const thrice = apply(start, 'rot', 0).placement;
  let stepped = start;
  for (let i = 0; i < 3; i += 1) stepped = rot.rotatePlacement(stepped, lib.getPart);
  eq({ at: thrice.at, rot: thrice.rot }, { at: stepped.at, rot: stepped.rot },
    'three quarters: panel and button agree');
});

s.check('setting the rotation it already has changes nothing', () => {
  const start = R1();
  const { placement } = apply(start, 'rot', 0);
  eq({ at: placement.at, rot: placement.rot }, { at: start.at, rot: start.rot }, 'unchanged');
});

// --------------------------------------------------------------- refusals

const refuses = (pl, field, value, what) => {
  const before = JSON.stringify(pl);
  const { placement, error } = E.applyPlacementEdit(pl, lib.getPart, field, value);
  ok(error, `${what}: an error came back`);
  eq(JSON.stringify(placement), before, `${what}: THE PLACEMENT IS UNCHANGED`);
};

s.check('a span below the minimum is refused', () => {
  refuses(R1(), 'span', 1, 'span 1 on a part with minSpan 2');
});

s.check('a non-integer span is refused', () => {
  refuses(R1(), 'span', 2.5, 'span 2.5');
  refuses(R1(), 'span', 'four', 'span "four"');
});

s.check('a width below the minimum is refused', () => {
  refuses(U1(), 'width', 1, 'width 1');
});

s.check('a rotation that is not a quarter turn is refused', () => {
  refuses(R1(), 'rot', 45, 'rot 45');
  refuses(R1(), 'rot', 360, 'rot 360');
});

s.check('an empty ref is refused', () => {
  refuses(R1(), 'ref', '', 'empty ref');
  refuses(R1(), 'ref', '   ', 'whitespace ref');
});

s.check('a non-integer position is refused', () => {
  refuses(R1(), 'col', 3.5, 'col 3.5');
  refuses(R1(), 'row', 'x', 'row "x"');
});

s.check('A FIELD THE PART DOES NOT HAVE IS REFUSED', () => {
  refuses(R1(), 'width', 6, 'width on a resistor');
  refuses({ ref: 'LED1', part: 'led', at: { col: 1, row: 1 }, rot: 0 },
    'span', 4, 'span on an LED');
});

s.check('an unknown field is refused', () => {
  refuses(R1(), 'colour', 'red', 'colour');
});

s.check('the refusal says what was wrong', () => {
  const { error } = apply(R1(), 'span', 1);
  ok(typeof error === 'string' && error.length > 8, `a readable message: ${error}`);
});

s.check('editing never mutates the placement it was given', () => {
  const start = R1();
  const snapshot = JSON.stringify(start);
  apply(start, 'span', 8);
  apply(start, 'rot', 90);
  eq(JSON.stringify(start), snapshot, 'input untouched');
});

s.check('a duplicate ref is allowed through, to be reported not prevented', () => {
  // Refusing mid-type would stop you swapping two refs over. validateProject and
  // the DRC already report duplicate-ref.
  const { error } = apply(R1(), 'ref', 'U1');
  ok(!error, 'not refused here');
});

process.exit((await s.run()) ? 0 : 1);
