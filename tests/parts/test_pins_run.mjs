// A part declares which way its pins cross the strips, and its default
// rotation is derived from that.
// Governed by docs/specs/pins-run-across-strips.md
//
// Peter, 2026-09-17: "90% of lib items I add and out by 90/270 degrees. each lib
// item needs to somehow identify it's pin -> strip orientation."

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const lib = await softImport('../../src/parts/library.js', here);
const dev = await softImport('../../src/parts/devices.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const ops = await softImport('../../src/model/ops.js', here);
const drcm = await softImport('../../src/net/drc.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('pins-run');

const B = { cols: 20, rows: 14, pattern: 'strip' };
const electrical = (id) => lib.pinsOf(lib.getPart(id)).filter((p) => p.electrical !== false);
const at = (id, r, extra = {}) => ({ ref: 'X1', part: id, at: { col: 8, row: 6 }, rot: r, ...extra });
const firstTwo = (pl) => rot.resolvePins([pl], lib.getPart).filter((p) => p.electrical).slice(0, 2);
const codes = (placements) => drcm.drc(B, [], placements, lib.getPart, []);

s.check('EVERY PART WITH A PIN ROW DECLARES WHICH WAY IT RUNS', () => {
  const missing = Object.keys(lib.PARTS)
    .filter((id) => lib.placesWith(lib.getPart(id)) !== 'wire' && electrical(id).length >= 2)
    .filter((id) => !['across', 'along', 'either'].includes(lib.getPart(id).pinsRun));
  eq(missing, [], 'parts with no pinsRun');
});

s.check('THE DERIVED DEFAULT PUTS PINS 1 AND 2 WHERE THE PART SAYS', () => {
  for (const id of Object.keys(lib.PARTS)) {
    const part = lib.getPart(id);
    if (part.pinsRun !== 'across' && part.pinsRun !== 'along') continue;
    const [a, b] = firstTwo(at(id, lib.defaultRotOf(part)));
    if (part.pinsRun === 'across') ok(a.row !== b.row, `${id}: across, pins 1 and 2 on different strips`);
    else eq(a.row, b.row, `${id}: along, pins 1 and 2 on one strip`);
  }
});

s.check('THE ONES PETER PLACES: across at 90, SMT at 0, and nothing typed', () => {
  for (const id of ['res-axial', 'dip', 'to92', 'header', 'jst-xh', 'wire-link']) {
    eq(lib.defaultRotOf(lib.getPart(id)), 90, `${id} defaults to 90`);
  }
  for (const id of ['smt-0603', 'sot23']) eq(lib.defaultRotOf(lib.getPart(id)), 0, `${id} defaults to 0`);
  eq(Object.keys(lib.PARTS).filter((id) => lib.getPart(id).defaultRot != null), [],
    'no part carries a typed defaultRot');
});

s.check('A DEVICE INHERITS, MAY OVERRIDE, AND THE OVERRIDE TRAVELS', () => {
  const pins = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const good = { id: 'pins-run-probe', name: 'probe', category: 'module', base: 'dip', span: 4, width: 3, pins, pinsRun: 'along' };
  eq(dev.validateDevice({ ...good, pinsRun: 'sideways' })?.includes('pinsRun') ?? false, true,
    'a bad pinsRun is refused, naming the field');
  eq(dev.validateDevice(good), null, 'along is accepted');
  eq(dev.validateDevice({ ...good, pinsRun: 'either' }), null, 'either is accepted');
  dev.installDevices([good]);
  try {
    eq(dev.placementFor('pins-run-probe', { col: 2, row: 2 }).pinsRun, 'along', 'placementFor copies it');
    eq(dev.placementFor('xiao', { col: 2, row: 2 }).pinsRun, undefined, 'a device that overrides nothing copies nothing');
  } finally { dev.installDevices([]); }
});

s.check('addPart WITH NO ROTATION PLACES ACROSS THE STRIPS; AN EXPLICIT ONE IS HONOURED', () => {
  const p = boardm.makeProject({ cols: 20, rows: 14 });
  const r1 = ops.addPart(p, { part: 'res-axial', at: { col: 3, row: 3 } });
  ok(!r1.error, `placed: ${r1.error}`);
  const pl1 = r1.project.placements.at(-1);
  const [a, b] = firstTwo(pl1);
  ok(a.row !== b.row, `default rot ${pl1.rot}: legs on different strips`);
  const r2 = ops.addPart(p, { part: 'res-axial', at: { col: 3, row: 3 }, rot: 0 });
  eq(r2.project.placements.at(-1).rot, 0, 'rot 0 asked for, rot 0 given');
});

s.check('TURNED AGAINST ITS DECLARATION IS A WARNING', () => {
  const find = (pls) => codes(pls).filter((f) => f.code === 'pins-against-strips');
  const r0 = find([at('res-axial', 0)]);
  eq(r0.length, 1, 'a resistor along a strip warns');
  eq(r0[0]?.severity, 'warning', 'as a warning, not an error');
  eq(find([at('res-axial', 90)]).length, 0, 'across, it does not');
  // An 0603 is built both ways — along a strip over a cut, or bridging two
  // adjacent strips with none. 555-blinker-v2 has six at 90 and is clean; a
  // warning on each would say a working board is wrong.
  eq(find([at('smt-0603', 0)]).length + find([at('smt-0603', 90)]).length, 0,
    'an 0603 is either, so neither way warns');
  eq(find([at('sot23', 0)]).length, 0, 'a SOT-23 along its strip does not warn');
  eq(find([at('sot23', 90)]).length, 1, 'a SOT-23 across the strips does');
  eq(find([at('dip', 0, { span: 4, width: 3, pinsRun: 'along' })]).length, 0,
    'a placement override is what the warning reads');
});

process.exit((await s.run()) ? 0 : 1);
