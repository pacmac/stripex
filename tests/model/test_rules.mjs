// The design rules Peter stated, as something the board carries and enforces.
// Governed by docs/specs/rules-and-ops.md
//
// Every check here is a mistake I actually made on his rotator board today,
// while the rules sat in a document where they bound nothing.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/model/rules.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('rules');

// A board with a ground rail on row 0, a signal strip on row 2, and a resistor
// whose pins occupy two holes.
function board() {
  const p = boardm.makeProject({ cols: 16, rows: 8 });
  p.placements.push({ ref: 'R1', part: 'res-axial', at: { col: 4, row: 2 }, rot: 0, span: 4 });
  p.netLabels = { '0,0': { name: '0V' }, '0,2': { name: 'STEP' } };
  return p;
}

// ------------------------------------------------------- the rules are data

s.check('A BOARD WITHOUT RULES GETS THE DEFAULTS', () => {
  // So every board that exists today opens unchanged and acquires them.
  const r = R.rulesFor(board());
  eq(r.linksAreStraight, true, 'links are straight');
  eq(r.penWiresFreeHolesOnly, true, 'pen wires use free holes');
  eq(r.penWiresSignalsOnly, true, 'pen wires are for signals');
});

s.check('and a board carrying its own keeps them', () => {
  // IN THE PROJECT, not beside the application: a saved board must reproduce its
  // own findings, or opening it on another machine reports different errors
  // about identical copper.
  const p = board();
  p.rules = { ...R.DEFAULT_RULES, penWiresSignalsOnly: false };
  eq(R.rulesFor(p).penWiresSignalsOnly, false, 'the board decides');
  eq(R.rulesFor(p).linksAreStraight, true, 'and the rest still default');
});

s.check('NET CLASS COMES FROM THE NAME', () => {
  // The only thing that knows whether a net is power is what it is called.
  for (const n of ['0V', 'GND', 'VSS', 'VMOT', 'VUSB', '3V3', '5V', '+12V', 'VCC']) {
    eq(R.netClassOf(n), 'power', n);
  }
  for (const n of ['STEP', 'DIR', 'EN', 'SDA', 'SCL', 'PDN', 'A', 'n7']) {
    eq(R.netClassOf(n), 'signal', n);
  }
});

s.check('and an unnamed net is a signal', () => {
  eq(R.netClassOf(null), 'signal', 'null');
  eq(R.netClassOf(''), 'signal', 'empty');
});

s.check('the patterns are part of the rule set, not the code', () => {
  // So the day somebody calls a rail RAW it is an edit, not a release.
  const rules = { ...R.DEFAULT_RULES, netClasses: { power: ['^RAW$'] } };
  eq(R.netClassOf('RAW', rules), 'power', 'RAW is power here');
  eq(R.netClassOf('0V', rules), 'signal', 'and the defaults were replaced, not merged');
});

// ------------------------------- the two faults I made on his board

s.check('A PEN WIRE ENDING ON A PIN IS A FINDING', () => {
  // Nine of my ten endpoints landed in a hole that already had a pin in it. The
  // DRC said zero errors, and its source documents the OPPOSITE rule — so
  // nothing anywhere would have stopped me.
  const p = board();
  p.wires.push({ ref: 'A', from: { col: 4, row: 2 }, to: { col: 9, row: 4 } });
  const f = R.checkRules(p);
  const hit = f.find((x) => x.code === 'pen-wire-on-a-pin');
  ok(hit, `flagged: ${JSON.stringify(f.map((x) => x.code))}`);
  ok(hit.refs.includes('A'), 'and names the wire');
});

s.check('and a pen wire between two free holes is not', () => {
  const p = board();
  p.wires.push({ ref: 'A', from: { col: 12, row: 2 }, to: { col: 12, row: 4 } });
  eq(R.checkRules(p).filter((x) => x.code === 'pen-wire-on-a-pin'), [], 'nothing to say');
});

s.check('A PEN WIRE ON A POWER NET IS A FINDING', () => {
  // Peter: "point to point can be anywhere for signals only. power lines must be
  // wire links." I wrote that into a spec myself and then grounded CLK with a
  // pen wire.
  const p = board();
  p.wires.push({ ref: 'A', from: { col: 12, row: 0 }, to: { col: 12, row: 4 } });
  const hit = R.checkRules(p).find((x) => x.code === 'pen-wire-on-power');
  ok(hit, 'flagged');
  ok(/0V|power/i.test(hit.message), `and says which rail: ${hit.message}`);
});

s.check('a pen wire between two signal nets is fine', () => {
  const p = board();
  p.wires.push({ ref: 'A', from: { col: 12, row: 2 }, to: { col: 12, row: 4 } });
  eq(R.checkRules(p).filter((x) => x.code === 'pen-wire-on-power'), [], 'nothing to say');
});

s.check('A LINK IS STRAIGHT BY CONSTRUCTION, SO NOTHING CHECKS IT', () => {
  // Peter's rule is "wire links can only be straight", and it cannot be broken
  // by a placement: a link's pins are collinear in the library and a rotation is
  // one of four right angles, so there is no diagonal to find. A checker for it
  // would be code that can never fire — which is worse than no checker, because
  // it reads as protection.
  //
  // The rule is enforced where it CAN be broken: addLink refuses two holes that
  // are not in line. See tests/model/test_ops.mjs.
  const p = board();
  for (const rot of [0, 90, 180, 270]) {
    p.placements.push({ ref: `L${rot}`, part: 'wire-link', at: { col: 2, row: 4 }, rot, span: 3 });
  }
  eq(R.checkRules(p).filter((x) => x.code === 'link-not-straight'), [],
    'no placement can produce a diagonal link');
});

s.check('A CLEAN BOARD PRODUCES NOTHING', () => {
  // The check that stops this being a machine for generating noise.
  eq(R.checkRules(board()), [], 'nothing to report');
});

s.check('and a rule switched off stops reporting', () => {
  const p = board();
  p.wires.push({ ref: 'A', from: { col: 4, row: 2 }, to: { col: 9, row: 4 } });
  p.rules = { ...R.DEFAULT_RULES, penWiresFreeHolesOnly: false };
  eq(R.checkRules(p).filter((x) => x.code === 'pen-wire-on-a-pin'), [], 'silent when told to be');
});

s.check('findings are shaped like the DRC’s', () => {
  // So the Checks tab shows them without learning a second format.
  const p = board();
  p.wires.push({ ref: 'A', from: { col: 4, row: 2 }, to: { col: 9, row: 4 } });
  const f = R.checkRules(p)[0];
  ok(f.severity && f.code && f.message, 'severity, code, message');
  ok(Array.isArray(f.refs) && Array.isArray(f.holes), 'refs and holes are lists');
});

process.exit((await s.run()) ? 0 : 1);
