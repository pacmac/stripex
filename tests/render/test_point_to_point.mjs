// A pen wire is two pads sharing an ID, not a drawn line.
// Governed by docs/specs/point-to-point-pads.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const L = await softImport('../../src/model/labels.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const R = await softImport('../../src/render/svg.js', here);
const C = await softImport('../../src/render/colours.js', here);

const s = suite('point-to-point');

const els = (svg, kind) => [...String(svg).matchAll(
  new RegExp(`<[^>]*data-kind="${kind}"[^>]*>`, 'g'),
)].map((m) => m[0]);
const attr = (el, name) => {
  const m = el.match(new RegExp(`(?:^|[ ])${name}="([^"]*)"`));
  return m ? m[1] : null;
};

// --------------------------------------------------------------- the labels

s.check('THE SCHEME IS A TO Z THEN AA, AB', () => {
  eq(L.columnLabel(1), 'A', '1');
  eq(L.columnLabel(26), 'Z', '26');
  // Bijective base 26 has no zero digit, which is why Z is followed by AA and
  // not by BA.
  eq(L.columnLabel(27), 'AA', '27');
  eq(L.columnLabel(28), 'AB', '28');
  eq(L.columnLabel(52), 'AZ', '52');
  eq(L.columnLabel(53), 'BA', '53');
  eq(L.columnLabel(702), 'ZZ', '702');
  eq(L.columnLabel(703), 'AAA', '703');
});

s.check('labelIndex inverts columnLabel', () => {
  for (const n of [1, 2, 26, 27, 28, 52, 53, 701, 702, 703]) {
    eq(L.labelIndex(L.columnLabel(n)), n, `round trip ${n}`);
  }
});

s.check('labelIndex ignores anything that is not a plain letter label', () => {
  eq(L.labelIndex('W1'), 0, 'W1 is not a column label');
  eq(L.labelIndex('R12'), 0, 'nor is R12');
  eq(L.labelIndex(''), 0, 'nor an empty one');
});

s.check('SORTING IS BY LENGTH FIRST, NOT A STRING COMPARE', () => {
  // A plain lexical sort gives A, AA, AB, B — useless in a build document you
  // work down.
  const refs = ['B', 'AA', 'A', 'Z', 'AB', 'C'];
  eq([...refs].sort(L.compareLabels), ['A', 'B', 'C', 'Z', 'AA', 'AB'], 'ordered');
  ok(JSON.stringify([...refs].sort()) !== JSON.stringify([...refs].sort(L.compareLabels)),
    'and that differs from a plain sort');
});

s.check('old W refs still sort somewhere sensible rather than throwing', () => {
  const refs = ['B', 'W2', 'A', 'W10'];
  const out = [...refs].sort(L.compareLabels);
  eq(out.length, 4, 'all four survive');
  ok(out.indexOf('A') < out.indexOf('B'), 'letters keep their order');
});

// ----------------------------------------------------------- allocating refs

s.check('A NEW PEN WIRE IS CALLED A, THEN B', () => {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  eq(boardm.nextWireRef(p), 'A', 'first');
  p.wires.push({ ref: 'A', from: { col: 0, row: 0 }, to: { col: 3, row: 0 } });
  eq(boardm.nextWireRef(p), 'B', 'second');
});

s.check('deleting a wire frees its letter', () => {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.wires.push({ ref: 'A' }, { ref: 'C' });
  eq(boardm.nextWireRef(p), 'B', 'the gap is filled');
});

s.check('a part cannot be shadowed, because refs share one namespace', () => {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.placements.push({ ref: 'A', part: 'res-axial', span: 2, at: { col: 0, row: 0 }, rot: 0 });
  eq(boardm.nextWireRef(p), 'B', 'A is taken by a part');
});

s.check('projects already using W refs keep them', () => {
  // Nothing distinguishes an auto-allocated ref from one somebody typed, so
  // renumbering on load would silently rewrite a deliberate name.
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.wires.push({ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 3, row: 0 } });
  const svg = R.renderBoard(p, {});
  ok(svg.includes('data-ref="W1"'), 'W1 is still drawn under its own name');
  eq(boardm.nextWireRef(p), 'A', 'and a new wire still gets A');
});

// ------------------------------------------------------------------ drawing

function withWire(extra = {}) {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.wires.push({ ref: 'A', from: { col: 2, row: 2 }, to: { col: 7, row: 5 }, ...extra });
  return p;
}

s.check('A PEN WIRE DRAWS TWO PADS AND NO LINE', () => {
  const svg = R.renderBoard(withWire(), {});
  eq(els(svg, 'wire-pad').length, 2, 'two pads');
  eq(els(svg, 'wire').length, 0, 'and no line');
  eq(els(svg, 'wire-casing').length, 0, 'nor a casing for one');
});

s.check('BOTH PADS CARRY THE SAME ID', () => {
  const pads = els(R.renderBoard(withWire(), {}), 'wire-pad');
  eq(pads.map((e) => attr(e, 'data-ref')), ['A', 'A'], 'same ref');
  const labels = els(R.renderBoard(withWire(), {}), 'wire-label');
  eq(labels.length, 2, 'and the ID is written at both ends');
});

s.check('both pads carry the wire’s length colour', () => {
  const p = withWire();
  const want = C.wireColour(p.wires[0]);
  for (const pad of els(R.renderBoard(p, {}), 'wire-pad')) {
    eq(attr(pad, 'fill'), want, 'pad fill');
  }
  // 2,2 to 7,5 is hypot(5,3) = 5.83, rounded to 6 holes: blue.
  eq(want, C.COLOUR_CODE[6].hex, 'a 6-hole wire is blue');
});

s.check('the pads sit on the holes the wire terminates in', () => {
  const pads = els(R.renderBoard(withWire(), {}), 'wire-pad');
  eq(pads.map((e) => attr(e, 'data-hole')).sort(), ['2,2', '7,5'], 'the two ends');
});

s.check('a wire pad is filled, so it reads differently from a component pad', () => {
  const svg = R.renderBoard(withWire(), {});
  const wirePad = els(svg, 'wire-pad')[0];
  ok(attr(wirePad, 'fill') !== 'none', 'a wire pad is filled');
});

s.check('SELECTING THE WIRE DRAWS ITS LINE, AND ONLY ITS LINE', () => {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.wires.push({ ref: 'A', from: { col: 2, row: 2 }, to: { col: 7, row: 5 } });
  p.wires.push({ ref: 'B', from: { col: 1, row: 8 }, to: { col: 9, row: 9 } });
  eq(els(R.renderBoard(p, {}), 'wire').length, 0, 'nothing selected, no lines');
  const svg = R.renderBoard(p, { selection: { kind: 'wire', ref: 'A' } });
  const lines = els(svg, 'wire');
  eq(lines.length, 1, 'exactly one line');
  eq(attr(lines[0], 'data-ref'), 'A', 'and it is the selected wire');
});

s.check('the pads are still drawn while the line is showing', () => {
  const svg = R.renderBoard(withWire(), { selection: { kind: 'wire', ref: 'A' } });
  eq(els(svg, 'wire-pad').length, 2, 'both pads');
});

s.check('hiding the wires layer takes the pads with it', () => {
  eq(els(R.renderBoard(withWire(), { layers: { wires: false } }), 'wire-pad').length, 0,
    'no pads');
});

s.check('A DIRECT WIRE LINK IS UNAFFECTED — IT STILL DRAWS ITS LINE', () => {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.placements.push({ ref: 'L1', part: 'wire-link', span: 3, at: { col: 2, row: 2 }, rot: 90 });
  const svg = R.renderBoard(p, {});
  const body = els(svg, 'part-body')[0];
  ok(body, 'the link has a body');
  ok(body.startsWith('<line'), 'and it is a line');
  eq(els(svg, 'wire-pad').length, 0, 'a link is not a pen wire');
});

s.check('the nets a pen wire joins are unchanged by any of this', () => {
  const p = withWire();
  const { segmentNet } = R.netsFor(p);
  eq(segmentNet['s:2:0'], segmentNet['s:5:0'], 'rows 2 and 5 are still one net');
});

process.exit((await s.run()) ? 0 : 1);
