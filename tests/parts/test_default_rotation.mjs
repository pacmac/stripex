// A part may declare the rotation it should be placed at.
// Governed by docs/specs/break-hit-targets.md (follow-on requests)

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const lib = await softImport('../../src/parts/library.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const drcm = await softImport('../../src/net/drc.js', here);
const der = await softImport('../../src/net/derive.js', here);
const seg = await softImport('../../src/net/segments.js', here);

const s = suite('default-rotation');

const B = { cols: 20, rows: 12, pattern: 'strip' };

// A wire link's 90 is no longer typed: it declares pinsRun 'across' and the
// rotation is derived. The check that pinned the resistor and the DIP "flat" at
// 0 asserted the defect Peter reported — every pin on one strip — and has gone.
// See tests/parts/test_pins_run.mjs.
s.check('A WIRE LINK DEFAULTS TO 90 DEGREES', () => {
  eq(lib.getPart('wire-link').pinsRun, 'across', 'wire-link runs across the strips');
  eq(lib.defaultRotOf(lib.getPart('wire-link')), 90, 'so it defaults to 90');
});

s.check('AT 90 A LINK BRIDGES TWO STRIPS, WHICH IS WHAT A LINK IS FOR', () => {
  const link = { ref: 'L1', part: 'wire-link', span: 2, at: { col: 4, row: 3 }, rot: 90 };
  const pins = rot.resolvePins([link], lib.getPart);
  ok(pins[0].row !== pins[1].row, 'its ends are on different rows');
  eq(pins[0].col, pins[1].col, 'and the same column');

  const segs = seg.segments(B, []);
  const { segmentNet } = der.nets(segs, pins, [link], lib.getPart, []);
  eq(segmentNet['s:3:0'], segmentNet['s:5:0'], 'the two strips became one net');
});

s.check('AT 0 IT LIES ALONG ONE STRIP AND DOES NOTHING', () => {
  // Joining a segment to itself. This is what the old default produced.
  const link = { ref: 'L1', part: 'wire-link', span: 2, at: { col: 4, row: 3 }, rot: 0 };
  const pins = rot.resolvePins([link], lib.getPart);
  eq(pins[0].row, pins[1].row, 'both ends on one row');
  const codes = drcm.drc(B, [], [link], lib.getPart, []).map((f) => f.code);
  ok(codes.includes('link-redundant'), 'and the DRC calls it redundant');
});

s.check('...so the declared default is the one that is not redundant', () => {
  const at90 = { ref: 'L1', part: 'wire-link', span: 2, at: { col: 4, row: 3 },
    rot: lib.defaultRotOf(lib.getPart('wire-link')) };
  const codes = drcm.drc(B, [], [at90], lib.getPart, []).map((f) => f.code);
  ok(!codes.includes('link-redundant'), 'not redundant at the default rotation');
});

s.check('the default is a legal rotation', () => {
  for (const id of Object.keys(lib.PARTS)) {
    ok(rot.isRotation(lib.defaultRotOf(lib.getPart(id))), `${id} default is a quarter turn`);
  }
});

s.check('a declared default does not stop it being rotated afterwards', () => {
  const link = { ref: 'L1', part: 'wire-link', span: 2, at: { col: 4, row: 3 }, rot: 90 };
  const turned = rot.rotatePlacement(link, lib.getPart);
  eq(turned.rot, 180, 'still turns');
});

process.exit((await s.run()) ? 0 : 1);
