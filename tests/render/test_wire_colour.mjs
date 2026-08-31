// Wire colour from LENGTH, and a wire link being wire and silkscreen both.
// Governed by docs/specs/wire-colour-by-length.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const C = await softImport('../../src/render/colours.js', here);
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('wire-colour');

const els = (svg, kind) => [...String(svg).matchAll(
  new RegExp(`<[^>]*data-kind="${kind}"[^>]*>`, 'g'),
)].map((m) => m[0]);
const attr = (el, name) => {
  const m = el.match(new RegExp(`(?:^|[ ])${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const code = (i) => C.COLOUR_CODE[i].hex;

// --------------------------------------------------------- length -> colour

s.check('A 3-HOLE WIRE IS ORANGE, WHATEVER IT IS CALLED', () => {
  eq(C.colourForLength(3), code(3), 'length 3');
  // The old behaviour keyed on the ref, so W1 was brown however long it was.
  eq(C.wireColour({ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 3, row: 0 } }),
    code(3), 'W1 spanning 3 holes is orange, not brown');
  eq(C.wireColour({ ref: 'W9', from: { col: 0, row: 0 }, to: { col: 3, row: 0 } }),
    code(3), 'and so is W9 spanning 3');
});

s.check('A 3-4-5 DIAGONAL IS A 5-HOLE WIRE', () => {
  // It is the same piece of wire as a straight 5-hole one, so it is the same
  // green.
  eq(C.wireLengthHoles({ from: { col: 0, row: 0 }, to: { col: 3, row: 4 } }), 5, 'length');
  eq(C.wireColour({ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 3, row: 4 } }),
    C.wireColour({ ref: 'W2', from: { col: 0, row: 0 }, to: { col: 5, row: 0 } }),
    'diagonal and straight agree');
});

s.check('the code wraps at ten, because the drawer has ten compartments', () => {
  eq(C.colourForLength(10), code(0), '10 is black');
  eq(C.colourForLength(11), code(1), '11 is brown like 1');
  eq(C.colourForLength(23), code(3), '23 is orange');
});

s.check('an explicit colour still wins', () => {
  eq(C.wireColour({ ref: 'W1', colour: '#ff00ff',
    from: { col: 0, row: 0 }, to: { col: 3, row: 0 } }), '#ff00ff', 'override');
});

// ------------------------------------------------ the link is wire and silk

function withLinks() {
  const p = boardm.makeProject({ cols: 24, rows: 10 });
  p.placements.push({ ref: 'L1', part: 'wire-link', span: 3, at: { col: 1, row: 1 }, rot: 0 });
  p.placements.push({ ref: 'L2', part: 'wire-link', span: 5, at: { col: 1, row: 4 }, rot: 0 });
  return p;
}
// EVERYTHING ONE PART DRAWS, up to wherever the next part starts.
//
// This used to cut at the first `</g>`, which assumed a part group contains no
// nested group. It never did for a JST — its body has always been drawn in a
// rotated group of its own — and now nothing does, because each body is wrapped
// in the group carrying its silkscreen clearance mask. Cutting at the next part
// is the thing that was actually meant.
const groupOf = (svg, ref) => {
  const from = svg.indexOf(`data-ref="${ref}"`);
  const rest = svg.slice(from);
  const next = rest.indexOf('<g data-kind="part"', 1);
  return next > 0 ? rest.slice(0, next) : rest;
};
const bodyOf = (svg, ref) => els(groupOf(svg, ref), 'part-body')[0];
const padsOf = (svg, ref) => els(groupOf(svg, ref), 'pad');

s.check('A LINK IS NO LONGER BLACK — IT TAKES THE COLOUR FOR ITS SPAN', () => {
  const svg = R.renderBoard(withLinks(), {});
  eq(attr(bodyOf(svg, 'L1'), 'stroke'), code(3), 'a 3-hole link is orange');
  eq(attr(bodyOf(svg, 'L2'), 'stroke'), code(5), 'a 5-hole link is green');
  ok(attr(bodyOf(svg, 'L1'), 'stroke') !== R.THEMES.light.silk, 'not the silk colour');
});

s.check("A LINK'S PADS STAY SILKSCREEN", () => {
  const svg = R.renderBoard(withLinks(), {});
  for (const pad of padsOf(svg, 'L1')) {
    eq(attr(pad, 'stroke'), R.THEMES.light.silk, 'pad is silk');
  }
});

s.check('recolouring the wire leaves the pads alone', () => {
  const p = withLinks();
  p.placements[0].colour = '#ff00ff';
  const svg = R.renderBoard(p, {});
  eq(attr(bodyOf(svg, 'L1'), 'stroke'), '#ff00ff', 'wire recoloured');
  eq(attr(padsOf(svg, 'L1')[0], 'stroke'), R.THEMES.light.silk, 'pads unchanged');
});

s.check('recolouring the silkscreen leaves the wire alone', () => {
  const p = withLinks();
  p.placements[0].silk = '#00a0a0';
  const svg = R.renderBoard(p, {});
  eq(attr(padsOf(svg, 'L1')[0], 'stroke'), '#00a0a0', 'pads recoloured');
  eq(attr(bodyOf(svg, 'L1'), 'stroke'), code(3), 'wire still the length colour');
});

s.check('an ordinary component is NOT wire-coloured', () => {
  const p = boardm.makeProject({ cols: 24, rows: 10 });
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 3, at: { col: 1, row: 1 }, rot: 0 });
  eq(attr(bodyOf(R.renderBoard(p, {}), 'R1'), 'stroke'), R.THEMES.light.silk, 'silk');
});

s.check('kind link is what marks a part as wire-coloured, not a second list', () => {
  ok(C.isWireColoured({ kind: 'link' }), 'a link is');
  ok(!C.isWireColoured({ kind: 'component' }), 'a component is not');
});

// -------------------------------------------------------------- the palette

s.check('THE PICKER OFFERS 16 COLOURS', () => {
  eq(C.PALETTE_16.length, 16, 'sixteen');
  eq(new Set(C.PALETTE_16.map((x) => x.hex)).size, 16, 'all different');
  for (const x of C.PALETTE_16) ok(/^#[0-9a-f]{6}$/.test(x.hex), `${x.name} is a hex colour`);
});

s.check('every code colour is in the palette, so a wire can be set to any of them', () => {
  const inPalette = new Set(C.PALETTE_16.map((x) => x.hex));
  for (const c of C.COLOUR_CODE) ok(inPalette.has(c.hex), `${c.name} is offered`);
});

s.check('CLEARING A COLOUR RETURNS IT TO THE DERIVED ONE', () => {
  // Without this there is no way back to "whatever the length says".
  const w = { ref: 'W1', from: { col: 0, row: 0 }, to: { col: 3, row: 0 }, colour: '#ff00ff' };
  eq(C.wireColour(w), '#ff00ff', 'overridden');
  delete w.colour;
  eq(C.wireColour(w), code(3), 'back to the length colour');
});

process.exit((await s.run()) ? 0 : 1);
