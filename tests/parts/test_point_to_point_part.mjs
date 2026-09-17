// Point to point is a thing you pick from the palette, not a mode you find.
// Governed by docs/specs/point-to-point-in-palette.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const lib = await softImport('../../src/parts/library.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const E = await softImport('../../src/model/edit.js', here);
const R = await softImport('../../src/render/svg.js', here);

const s = suite('p2p-part');

const els = (svg, kind) => [...String(svg).matchAll(
  new RegExp(`<[^>]*data-kind="${kind}"[^>]*>`, 'g'),
)].map((m) => m[0]);
const attr = (el, name) => {
  const m = el.match(new RegExp(`(?:^|[ ])${name}="([^"]*)"`));
  return m ? m[1] : null;
};

// ------------------------------------------------------- it is in the list

s.check('THE PALETTE HAS A POINT TO POINT ENTRY', () => {
  ok(lib.hasPart('point-to-point'), 'the library has it');
  const listed = lib.partList().find((p) => p.id === 'point-to-point');
  ok(listed, 'and partList offers it');
  ok(listed.name && listed.name.length > 3, `it has a name: ${listed?.name}`);
});

s.check('the palette is still built from ONE list', () => {
  // A second source for the palette is the defect that shipped a part called X1
  // when ref prefixes drifted from the library.
  const ids = lib.partList().map((p) => p.id);
  eq(new Set(ids).size, ids.length, 'no duplicates');
  eq(ids.length, Object.keys(lib.PARTS).length, 'partList covers exactly PARTS');
});

s.check('IT ARMS THE WIRE TOOL RATHER THAN THE PLACE TOOL', () => {
  eq(lib.placesWith(lib.getPart('point-to-point')), 'wire', 'point-to-point');
  eq(lib.placesWith(lib.getPart('res-axial')), 'place', 'a resistor places normally');
  eq(lib.placesWith(lib.getPart('wire-link')), 'place', 'so does a wire link');
});

s.check('every other part still places normally', () => {
  for (const id of Object.keys(lib.PARTS)) {
    if (id === 'point-to-point') continue;
    eq(lib.placesWith(lib.getPart(id)), 'place', `${id}`);
  }
});

s.check('A WIRE-ONLY PART CANNOT BE A PLACEMENT', () => {
  // Nothing else would catch it: with no pins it resolves to no geometry, so it
  // would be invisible rather than reported.
  const p = boardm.makeProject({ cols: 12, rows: 8 });
  p.placements.push({ ref: 'X1', part: 'point-to-point', at: { col: 2, row: 2 }, rot: 0 });
  const problems = boardm.validateProject(p);
  ok(problems.length > 0, 'rejected');
  ok(problems.some((x) => /point.to.point|wire/i.test(x.message)),
    `and the reason names it: ${problems[0]?.message}`);
});

s.check('...while a real part is still accepted', () => {
  const p = boardm.makeProject({ cols: 12, rows: 8 });
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 3, at: { col: 2, row: 2 }, rot: 0 });
  eq(boardm.validateProject(p), [], 'no problems');
});

// ------------------------------------------------------ what a wire gained

const wireProject = (over = {}) => {
  const p = boardm.makeProject({ cols: 16, rows: 10 });
  p.wires.push({ ref: 'A', from: { col: 2, row: 2 }, to: { col: 8, row: 5 }, ...over });
  return p;
};

s.check('a wire takes a value, and it is drawn beside the ID', () => {
  const plain = R.renderBoard(wireProject(), {});
  eq(els(plain, 'wire-value').length, 0, 'nothing extra when unset');
  const named = R.renderBoard(wireProject({ value: 'GND' }), {});
  const vals = els(named, 'wire-value');
  eq(vals.length, 2, 'one at each end, like the ID');
  ok(named.includes('>GND<'), 'and it says GND');
});

s.check('THE ID LABEL TAKES THE WIRE’S SILK COLOUR', () => {
  // The default was the theme ink, which was right while the ID floated on the
  // board above its pad. It now sits INSIDE the pad — see
  // docs/specs/pen-pad-carries-its-id.md — so the default has to be chosen
  // against the length colour underneath it, or the black wire gets a black
  // letter on a black pad. Black is 0 in the code: the first wire anyone draws.
  const themed = R.renderBoard(wireProject(), {});
  const pad = els(themed, 'wire-pad')[0];
  eq(attr(els(themed, 'wire-label')[0], 'fill'),
    R.readableOn(attr(pad, 'fill'), R.THEMES.light), 'readable on the pad by default');
  const inked = R.renderBoard(wireProject({ silk: '#00a0a0' }), {});
  eq(attr(els(inked, 'wire-label')[0], 'fill'), '#00a0a0', 'and the wire’s silk when set');
});

s.check('THE PADS KEEP THE LENGTH COLOUR WHATEVER SILK SAYS', () => {
  // The pad colour is load-bearing: it says which pre-cut wire to take from the
  // drawer. Silk colours the letter, not the wire.
  const plain = R.renderBoard(wireProject(), {});
  const inked = R.renderBoard(wireProject({ silk: '#00a0a0' }), {});
  eq(attr(els(inked, 'wire-pad')[0], 'fill'), attr(els(plain, 'wire-pad')[0], 'fill'),
    'pad fill unchanged');
});

s.check('both fields apply through the editor and clear again', () => {
  const w = { ref: 'A', from: { col: 0, row: 0 }, to: { col: 3, row: 0 } };
  eq(E.applyWireEdit(w, 'value', '+5V').wire.value, '+5V', 'value set');
  eq(E.applyWireEdit(w, 'silk', '#123456').wire.silk, '#123456', 'silk set');
  ok(!('silk' in E.applyWireEdit({ ...w, silk: '#123456' }, 'silk', '').wire), 'silk cleared');
});

s.check('a bad silk colour is refused and the wire is unchanged', () => {
  const w = { ref: 'A', from: { col: 0, row: 0 }, to: { col: 3, row: 0 }, silk: '#111111' };
  const { wire, error } = E.applyWireEdit(w, 'silk', 'reddish');
  ok(error, 'refused');
  eq(wire.silk, '#111111', 'unchanged');
});

s.check('the value survives a wire being recoloured', () => {
  const w = { ref: 'A', from: { col: 0, row: 0 }, to: { col: 3, row: 0 }, value: 'GND' };
  eq(E.applyWireEdit(w, 'colour', '#ff00ff').wire.value, 'GND', 'still GND');
});

process.exit((await s.run()) ? 0 : 1);
