// A placement's side of the board: a default, and switchable.
// Governed by docs/specs/switchable-side.md
//
// Peter, 2026-09-17: "an item / component / object needs to be able to switch
// layer but have a default layer, mostly top."
//
// The half of this that matters most is the part that must NOT change: the
// field that said which face a part was on also said whether its pads occupy
// holes, so a DIP flipped to the copper side must still own its holes.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const lib = await softImport('../../src/parts/library.js', here);
const dev = await softImport('../../src/parts/devices.js', here);
const edit = await softImport('../../src/model/edit.js', here);
const ops = await softImport('../../src/model/ops.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const drcm = await softImport('../../src/net/drc.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const R = await softImport('../../src/render/svg.js', here);

const s = suite('side');
const B = { cols: 20, rows: 12, pattern: 'strip' };

s.check('A PLACEMENT HAS A SIDE: the part\'s by default, its own when set', () => {
  eq(lib.sideOf(lib.getPart('res-axial')), 'top', 'a resistor is top by default');
  eq(lib.sideOf(lib.getPart('smt-0603')), 'copper', 'an 0603 is copper side by default');
  eq(lib.sideOf(lib.getPart('res-axial'), { side: 'copper' }), 'copper', 'a placement\'s side wins');
  eq(lib.sideOf(lib.getPart('smt-0603'), { side: 'top' }), 'top', 'either way');
  eq(lib.sideOf(lib.getPart('res-axial'), {}), 'top', 'a placement with no side takes the part\'s');
});

s.check('SURFACE-MOUNT IS THE PART\'S FACT, NOT THE PLACEMENT\'S', () => {
  eq(typeof lib.isSurfaceMount, 'function', 'isSurfaceMount exists');
  if (typeof lib.isSurfaceMount !== 'function') return;
  eq(lib.isSurfaceMount(lib.getPart('smt-0603')), true, 'an 0603 is surface-mount');
  eq(lib.isSurfaceMount(lib.getPart('dip')), false, 'a DIP is not');
});

s.check('THE FOCUS EDIT SETS IT, AND REFUSES NONSENSE', () => {
  const pl = { ref: 'R1', part: 'res-axial', span: 4, at: { col: 3, row: 3 }, rot: 90 };
  const a = edit.applyPlacementEdit(pl, lib.getPart, 'side', 'copper');
  eq(a.error, null, `accepted: ${a.error}`);
  eq(a.placement.side, 'copper', 'side set');
  const b = edit.applyPlacementEdit(pl, lib.getPart, 'side', 'sideways');
  ok(b.error, 'a bad side is refused');
  eq(b.placement.side, undefined, 'and nothing changed');
});

s.check('THE API: addPart with side, setSide, and validation', () => {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  const a = ops.addPart(p, { part: 'res-axial', at: { col: 3, row: 3 }, side: 'copper' });
  eq(a.error, undefined, `placed: ${a.error}`);
  eq(a.project?.placements.at(-1).side, 'copper', 'addPart honours side');
  const b = ops.applyOps(a.project ?? p, [{ op: 'setSide', ref: 'R1', side: 'top' }]);
  eq(b.error, undefined, `setSide ran: ${b.error}`);
  eq(b.project?.placements.find((x) => x.ref === 'R1')?.side, 'top', 'setSide moves it back');
  const bad = boardm.validateProject({ ...p, placements: [{ ref: 'R9', part: 'res-axial', span: 4, at: { col: 1, row: 1 }, rot: 90, side: 'under' }] });
  ok(bad.some((x) => /side/.test(x.message)), `validateProject refuses a bad side: ${bad.map((x) => x.code)}`);
});

s.check('A DEVICE MAY DECLARE ITS SIDE, AND IT TRAVELS', () => {
  const d = { id: 'side-probe', name: 'probe', category: 'module', base: 'header', span: 3, pins: ['A', 'B', 'C'], side: 'copper' };
  eq(dev.validateDevice(d), null, 'a device side is accepted');
  ok(dev.validateDevice({ ...d, side: 'bottom' }), 'a bad one is refused');
  dev.installDevices([d]);
  try {
    eq(dev.placementFor('side-probe', { col: 2, row: 2 }).side, 'copper', 'placementFor copies it');
  } finally { dev.installDevices([]); }
});

s.check('A DIP ON THE COPPER SIDE STILL OWNS ITS HOLES', () => {
  const dip = { ref: 'U1', part: 'dip', span: 4, width: 3, at: { col: 5, row: 2 }, rot: 90, side: 'copper' };
  const pin = rot.resolvePins([dip], lib.getPart)[0];
  // A resistor lead dropped into the DIP's pin 1 hole.
  const r = { ref: 'R1', part: 'res-axial', span: 4, at: { col: pin.col, row: pin.row }, rot: 0 };
  const codes = drcm.drc(B, [], [dip, r], lib.getPart, []).map((f) => f.code);
  ok(codes.includes('hole-collision'), `two leads in one hole is still a collision: ${codes}`);
});

s.check('AN 0603 MOVED TO THE TOP STILL DOES NOT OCCUPY A HOLE', () => {
  const c = { ref: 'C1', part: 'smt-0603', at: { col: 5, row: 2 }, rot: 0, side: 'top' };
  const r = { ref: 'R1', part: 'res-axial', span: 4, at: { col: 5, row: 2 }, rot: 90 };
  const codes = drcm.drc(B, [], [c, r], lib.getPart, []).map((f) => f.code);
  ok(!codes.includes('hole-collision'), `no collision with a lead in its hole: ${codes}`);
});

s.check('THE DRAWING FOLLOWS THE PLACEMENT\'S SIDE', () => {
  const draw = (pl, view) => {
    const svg = R.renderBoard({ ...boardm.makeProject({ cols: 12, rows: 8 }), placements: [pl] }, { view });
    const g = svg.match(/<g data-kind="part" data-ref="R1"[^>]*>/)?.[0] ?? '';
    return { ghost: /opacity="/.test(g), body: /data-kind="part-body"/.test(svg), side: g.match(/data-side="([^"]*)"/)?.[1] };
  };
  const top = { ref: 'R1', part: 'res-axial', span: 4, at: { col: 3, row: 2 }, rot: 90 };
  const under = { ...top, side: 'copper' };
  eq(draw(top, 'top'), { ghost: false, body: true, side: 'top' }, 'on top, seen from the top: drawn');
  eq(draw(under, 'top'), { ghost: true, body: true, side: 'copper' }, 'on the copper side, from the top: ghosted');
  eq(draw(under, 'underside').body, true, 'on the copper side, from the underside: drawn');
  eq(draw(top, 'underside').body, false, 'on top, from the underside: not drawn, as before');

  // An 0603's pads are lands on either side.
  const pads = (side) => {
    const svg = R.renderBoard({ ...boardm.makeProject({ cols: 12, rows: 8 }),
      placements: [{ ref: 'C1', part: 'smt-0603', at: { col: 3, row: 2 }, rot: 0, side }] }, { view: 'top' });
    return [...svg.matchAll(/<(rect|circle)[^>]*data-kind="pad"/g)].map((m) => m[1]);
  };
  eq(pads('top'), ['rect', 'rect'], 'an 0603 on top keeps square lands');
  eq(pads('copper'), ['rect', 'rect'], 'and on the copper side');
});

process.exit((await s.run()) ? 0 : 1);
