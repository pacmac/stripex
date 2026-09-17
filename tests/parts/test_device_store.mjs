// The device catalogue is data, not code.
// Governed by docs/specs/component-editor.md
//
// Peter: "next task is a component editor screen" — scoped as both, catalogue
// first. Every component problem this week needed ME to edit source: the JST
// body was the wrong size twice, NC3 and NC4 are two pin names only his
// silkscreen can settle, and his SMT parts want a 1206 land the library does not
// have. He is the one holding the part and he cannot change the catalogue.
//
// THE BUILT-INS STAY THE DEFAULTS. A fresh install is complete with no file, and
// the store holds only what has been added or changed — which is also what makes
// the file worth reading.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const D = await softImport('../../src/parts/devices.js', here);
const O = await softImport('../../src/model/ops.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('device-store');

// A minimal, valid device: an 8-pin DIL with names of its own.
const CUSTOM = {
  id: 'my-eeprom',
  name: '24LC256 EEPROM',
  category: 'ic',
  base: 'dip',
  span: 4,
  width: 3,
  refPrefix: 'U',
  pinSource: 'read off the part',
  pins: ['A0', 'A1', 'A2', 'VSS', 'SDA', 'SCL', 'WP', 'VCC'],
};

const reset = () => D.installDevices([]);

// ------------------------------------------------- the built-ins survive

s.check('WITH NOTHING STORED, EVERY BUILT-IN IS STILL THERE', () => {
  reset();
  ok(D.getDevice('xiao'), 'the XIAO');
  ok(D.getDevice('tmc2209'), 'the TMC2209');
  ok(D.getDevice('jst-xh-3-right'), 'a JST');
  ok(D.deviceList().length >= 16, `and the whole list: ${D.deviceList().length}`);
});

s.check('and each says whether it is built in', () => {
  reset();
  const xiao = D.deviceList().find((d) => d.id === 'xiao');
  eq(xiao.builtIn, true, 'the XIAO is stock');
});

// ------------------------------------------------- adding one

s.check('A NEW DEVICE JOINS THE CATALOGUE', () => {
  reset();
  const out = D.installDevices([CUSTOM]);
  ok(!out.error, `it installed: ${out.error ?? ''}`);
  const d = D.getDevice('my-eeprom');
  ok(d, 'it is in the catalogue');
  eq(d.pins.length, 8, 'with its pins');
  eq(D.deviceList().find((x) => x.id === 'my-eeprom').builtIn, false, 'and it is not stock');
});

s.check('and it can be PLACED, which is the point of it', () => {
  reset();
  D.installDevices([CUSTOM]);
  const p = boardm.makeProject({ cols: 20, rows: 14 });
  const out = O.addPart(p, { device: 'my-eeprom', at: { col: 4, row: 4 }, rot: 90 });
  ok(!out.error, `placed: ${out.error ?? ''}`);
  const pl = out.project.placements[0];
  eq(pl.pinNames, CUSTOM.pins, 'carrying the names it was given');
  eq(pl.span, 4, 'and its span');
});

s.check('AN OVERRIDE REPLACES A BUILT-IN OF THE SAME ID', () => {
  // How Peter fixes NC3 and NC4 without me.
  reset();
  const names = [...D.getDevice('tmc2209').pins];
  names[2] = 'DIAG';
  names[3] = 'INDEX';
  D.installDevices([{ ...D.getDevice('tmc2209'), pins: names, unverifiedPins: [] }]);
  eq(D.getDevice('tmc2209').pins[2], 'DIAG', 'the corrected name');
  eq(D.deviceList().find((x) => x.id === 'tmc2209').builtIn, false, 'and it is no longer stock');
});

s.check('and dropping the override returns it to stock', () => {
  reset();
  eq(D.getDevice('tmc2209').pins[2], 'NC3', 'back to the built-in');
  eq(D.deviceList().find((x) => x.id === 'tmc2209').builtIn, true, 'and marked stock again');
});

// ------------------------------------------------- refused, with the reason

s.check('AN INVALID DEVICE IS REFUSED, NAMING WHAT IS WRONG', () => {
  reset();
  const cases = [
    [{ ...CUSTOM, id: 'Not A Slug' }, /slug|id/i],
    [{ ...CUSTOM, base: 'nonsense' }, /nonsense|base/i],
    [{ ...CUSTOM, pins: ['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G'] }, /duplicate|twice|"A"/i],
    [{ ...CUSTOM, pins: ['A', '', 'B', 'C', 'D', 'E', 'F', 'G'] }, /blank|empty|name/i],
    [{ ...CUSTOM, span: 0 }, /span/i],
    [{ ...CUSTOM, pins: ['A', 'B'] }, /8|2|pin/i],
  ];
  for (const [bad, expect] of cases) {
    const out = D.installDevices([bad]);
    ok(out.error, `${JSON.stringify(bad).slice(0, 60)} was refused`);
    ok(expect.test(out.error), `and says why: ${out.error}`);
  }
  reset();
});

s.check('and a refused batch changes nothing', () => {
  reset();
  D.installDevices([CUSTOM]);
  const before = D.deviceList().length;
  D.installDevices([CUSTOM, { ...CUSTOM, id: 'bad id' }]);
  eq(D.deviceList().length, before, 'the catalogue is untouched by a batch that fails');
  ok(D.getDevice('my-eeprom'), 'and what was there is still there');
  reset();
});

// ------------------------------------------------- the rule that matters

s.check('EDITING A DEVICE DOES NOT CHANGE A BOARD ALREADY BUILT FROM IT', () => {
  // placementFor COPIES the catalogue onto the placement — a placement owes the
  // catalogue nothing afterwards. That is the whole reason the copy exists, and
  // a component editor is exactly the feature that would break it if it did not.
  reset();
  D.installDevices([CUSTOM]);
  const p = boardm.makeProject({ cols: 20, rows: 14 });
  const built = O.addPart(p, { device: 'my-eeprom', at: { col: 4, row: 4 }, rot: 90 }).project;

  D.installDevices([{ ...CUSTOM, pins: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7', 'Z8'], span: 4 }]);
  eq(built.placements[0].pinNames, CUSTOM.pins, 'the board keeps the names it was built with');
  eq(D.getDevice('my-eeprom').pins[0], 'Z1', 'while the catalogue has moved on');
  reset();
});

process.exit(await s.run() ? 0 : 1);
