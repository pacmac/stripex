// Checks for the SOT-23 package.
// Governed by docs/specs/sot23-and-accepted-findings.md, part 1.
//
// Raised by `device` building rak4631-io-pir: an AO3401 went down as a TO-92
// because the catalogue had no SMT semiconductor. The warning that shaped these
// checks: three pads in a row called sot23 would be a second lie that looks
// right. A SOT-23 is a 2+1 straddle, chiral, and its third pad is off the grid.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const lib = await softImport('../../src/parts/library.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const brk = await softImport('../../src/model/breaks.js', here);
const drcm = await softImport('../../src/net/drc.js', here);
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('sot23');

const B = { cols: 10, rows: 6, pattern: 'strip' };
const Q = (r = 0, at = { col: 4, row: 2 }) => ({ ref: 'Q1', part: 'sot23', at, rot: r });
const codes = (breaks, placements) =>
  drcm.drc(B, breaks, placements, lib.getPart).map((f) => f.code);

s.check('THE CATALOGUE HAS A SOT-23: copper side, knife cut, three pins', () => {
  ok(lib.hasPart('sot23'), 'sot23 exists');
  const p = lib.getPart('sot23');
  eq(p.side, 'copper', 'mounted on the copper side');
  eq(p.requiresBreak, true, 'requires a cut');
  eq(p.breakType, 'knife', 'and it is a knife cut — there is no hole between pins 1 and 2');
  eq(lib.pinsOf(p).map((q) => q.name), ['1', '2', '3'], 'pins 1, 2, 3');
});

s.check('IT IS A 2+1 STRADDLE, NOT THREE IN A ROW', () => {
  const [p1, p2, p3] = rot.resolvePins([Q(0)], lib.getPart);
  eq(p1.row, p2.row, 'pins 1 and 2 on one strip');
  eq(p2.col - p1.col, 1, 'one hole apart');
  eq(Math.abs(p3.row - p1.row), 1, 'pin 3 on the adjacent strip');
});

s.check('PIN 3 IS DRAWN HALF A HOLE ALONG ITS STRIP, CENTRED, AT EVERY ROTATION', () => {
  for (const r of [0, 90, 180, 270]) {
    const [p1, p2, p3] = rot.resolvePins([Q(r)], lib.getPart);
    const d1 = [p1.drawCol ?? p1.col, p1.drawRow ?? p1.row];
    const d2 = [p2.drawCol ?? p2.col, p2.drawRow ?? p2.row];
    const d3 = [p3.drawCol, p3.drawRow];
    ok(Number.isInteger(p3.col) && Number.isInteger(p3.row),
      `rot ${r}: pin 3's connectivity hole is on the grid: ${p3.col},${p3.row}`);
    ok(d3.every(Number.isFinite), `rot ${r}: pin 3 has a draw position: ${d3}`);
    // Centred between pins 1 and 2 along their axis.
    const mid = [(d1[0] + d2[0]) / 2, (d1[1] + d2[1]) / 2];
    const along = d1[0] === d2[0] ? 1 : 0;   // the axis pins 1 and 2 share
    eq(d3[along], mid[along], `rot ${r}: pin 3 centred between pins 1 and 2`);
  }
});

s.check('THE DERIVED CUT IS ONE KNIFE CUT, BETWEEN PINS 1 AND 2', () => {
  const [p1] = rot.resolvePins([Q(0)], lib.getPart);
  const cuts = brk.requiredBreaks(Q(0), lib.getPart);
  eq(cuts, [{ row: p1.row, x: p1.col, at: 'gap' }], 'one gap cut on the pin 1/2 strip');
});

s.check('THE UNDERSIDE VIEW HAS THE HANDEDNESS OF THE REAL PART', () => {
  // Marking side up, a SOT-23 reads pin 1 bottom-left, 2 bottom-right, 3 top
  // centre. On the copper side the marking faces away from the board, so the
  // underside view is the one that must match. In screen coordinates (y down)
  // that outline gives a negative cross product for 1 -> 2 -> 3.
  const project = { ...boardm.makeProject({ cols: 10, rows: 6, name: 't' }), placements: [Q(0)] };
  const svg = R.renderBoard(project, { view: 'underside' });
  const pads = [...svg.matchAll(/<rect[^>]*data-kind="pad"[^>]*>/g)].map((m) => {
    const g = (a) => Number(m[0].match(new RegExp(` ${a}="([^"]*)"`))[1]);
    return { pin: m[0].match(/data-pin="([^"]*)"/)[1], x: g('x') + g('width') / 2, y: g('y') + g('height') / 2 };
  });
  eq(pads.map((p) => p.pin), ['1', '2', '3'], 'three square lands');
  const [a, b, c] = pads;
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  ok(cross < 0, `same handedness as the standard outline: cross ${cross.toFixed(2)}`);
  // And the pad is drawn where the part is, not at the hole.
  ok(Math.abs(c.x - (a.x + b.x) / 2) < 1e-6, `pin 3's land is drawn centred: ${c.x} vs ${(a.x + b.x) / 2}`);
});

s.check('THE DRAWING SAYS WHICH END IS PIN 1', () => {
  // Found on screen: all three lands are square — the copper-side rule that
  // an 0603 has no pin 1 — so pins 1 and 2 were mirror images. A two-terminal
  // passive has no orientation; a SOT-23 does, and on an AO3401 pin 1 is the
  // gate and pin 2 the source. A dot on the package, as the real part carries,
  // nearer pin 1 than pin 2, in both views.
  for (const view of ['top', 'underside']) {
    for (const r of [0, 180]) {
      const project = { ...boardm.makeProject({ cols: 10, rows: 6, name: 't' }), placements: [Q(r)] };
      const svg = R.renderBoard(project, { view });
      const dot = svg.match(/<circle[^>]*data-kind="pin1-mark"[^>]*>/);
      ok(dot, `${view} rot ${r}: a pin 1 mark is drawn`);
      if (!dot) continue;
      // The mark sits inside a transformed group, so compare in board space by
      // asking where pins 1 and 2 are and which the group's local x points at.
      const g = svg.match(/<g transform="translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\) scale\(1 (-?1)\)">(?:(?!<\/g>).)*data-kind="pin1-mark"/);
      ok(g, `${view} rot ${r}: the mark is inside the body's own frame`);
      if (!g) continue;
      const lx = Number(dot[0].match(/ cx="([^"]*)"/)[1]);
      const ly = Number(dot[0].match(/ cy="([^"]*)"/)[1]);
      const [tx, ty, deg, sy] = g.slice(1, 5).map(Number);
      const a = (deg * Math.PI) / 180;
      const bx = tx + lx * Math.cos(a) - ly * sy * Math.sin(a);
      const by = ty + lx * Math.sin(a) + ly * sy * Math.cos(a);
      const pads = [...svg.matchAll(/<rect[^>]*data-kind="pad"[^>]*>/g)].map((m) => {
        const v = (k) => Number(m[0].match(new RegExp(` ${k}="([^"]*)"`))[1]);
        return { x: v('x') + v('width') / 2, y: v('y') + v('height') / 2 };
      });
      const d = (p) => Math.hypot(p.x - bx, p.y - by);
      ok(d(pads[0]) < d(pads[1]), `${view} rot ${r}: nearer pin 1 (${d(pads[0]).toFixed(2)}) than pin 2 (${d(pads[1]).toFixed(2)})`);
    }
  }
});

s.check('A PACKAGE IS NAMED FOR ITS SHAPE, NOT FOR ONE THING IT MIGHT HOLD', () => {
  // Peter: "not sure that should be named transistor, could be a FET, a
  // Transistor, a Regulator, a Diode." The same is true of a TO-92 (a 78L05 is
  // one) and a TO-220. What the part IS belongs to a device entry.
  for (const [id, code] of [['sot23', /SOT-23/], ['to92', /TO-92/], ['to220', /TO-220/]]) {
    const name = lib.getPart(id).name;
    ok(code.test(name), `${id} is named by its package: "${name}"`);
    ok(!/transistor|regulator|diode|fet|mosfet/i.test(name), `${id} names no function: "${name}"`);
  }
  // A bare SOT-23 has no function to take a letter from, so it takes the
  // generic one; a device entry supplies Q, D or U for what is really in it.
  eq(lib.getPart('sot23').refPrefix, 'U', 'sot23 takes the generic prefix');
});

s.check('A SOT-23 MOSFET IS A DEVICE: G, S, D, prefix Q, along its strip', async () => {
  // Peter: "Looks like we will need a SOT-23 FET component. I believe most share
  // the same GDS pins ?" They do, for MOSFETs: 2N7002, BSS138, AO3400/3401,
  // Si2302 are all 1 G, 2 S, 3 D. BJTs (1 B, 2 E, 3 C) and JFETs do not, which
  // is why this is a MOSFET device and not the package's own pin names.
  const dev = await softImport('../../src/parts/devices.js', here);
  const d = dev.getDevice('sot23-mosfet');
  ok(d, 'the sot23-mosfet device exists');
  if (!d) return;
  eq(d.base, 'sot23', 'built on the SOT-23 package');
  eq(d.pins, ['G', 'S', 'D'], 'pins G, S, D');
  eq(d.refPrefix, 'Q', 'prefix Q');
  eq(d.category, 'semiconductor', 'listed with the semiconductors');
  ok(String(d.pinSource ?? '').length > 20, `says where the pinout came from: "${d.pinSource}"`);
  eq(dev.validateDevice(d), null, 'valid');
  const pl = dev.placementFor('sot23-mosfet', { col: 3, row: 2 }, lib.defaultRotOf(lib.getPart('sot23'), d.pinsRun));
  eq(pl.rot, 0, 'places along its strip');
  const [g, sPin] = rot.resolvePins([pl], lib.getPart);
  eq([g.pin, sPin.pin, g.row === sPin.row], ['G', 'S', true], 'G and S share a strip, with a derived cut between them');
});

s.check('A CORRECTLY CUT SOT-23 IS CLEAN', () => {
  const cuts = brk.requiredBreaks(Q(0), lib.getPart);
  const c = codes(cuts, [Q(0)]);
  eq(c.filter((x) => /pad-|short-across|missing-required/.test(x)), [], `no findings: ${c}`);
});

s.check('A KNIFE CUT UNDER PIN 3 IS A PAD OVER A CUT', () => {
  const [, , p3] = rot.resolvePins([Q(0)], lib.getPart);
  const cuts = [...brk.requiredBreaks(Q(0), lib.getPart), { row: p3.row, x: Math.floor(p3.drawCol), at: 'gap' }];
  ok(codes(cuts, [Q(0)]).includes('pad-over-cut'), `pad-over-cut: ${codes(cuts, [Q(0)])}`);
});

s.check('ACROSS THE STRIPS IT CANNOT BE BUILT', () => {
  for (const r of [90, 270]) {
    ok(codes([], [Q(r)]).includes('pad-between-strips'), `rot ${r}: pad-between-strips`);
  }
  ok(!codes([], [Q(180)]).includes('pad-between-strips'), 'rot 180 is fine');
});

process.exit((await s.run()) ? 0 : 1);
