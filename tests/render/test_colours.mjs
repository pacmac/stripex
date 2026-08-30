// Wire colours from the 0-9 code, part colours, and telling a cut strip's
// segments apart. Plus Escape returning to Select.
// Governed by docs/specs/colour-and-escape.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const C = await softImport('../../src/render/colours.js', here);
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const E = await softImport('../../src/model/edit.js', here);
const lib = await softImport('../../src/parts/library.js', here);

const s = suite('colours');

const els = (svg, kind) => [...String(svg).matchAll(
  new RegExp(`<[^>]*data-kind="${kind}"[^>]*>`, 'g'),
)].map((m) => m[0]);
const attr = (el, name) => {
  const m = el.match(new RegExp(`(?:^|[ ])${name}="([^"]*)"`));
  return m ? m[1] : null;
};

// ------------------------------------------------------- the 0-9 code

s.check('THE CODE IS THE STANDARD ONE, BLACK THROUGH WHITE', () => {
  eq(C.COLOUR_CODE.length, 10, 'ten colours');
  eq(C.COLOUR_CODE.map((x) => x.name),
    ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'],
    'in order');
});

// Corrected 2026-08-30: the code is keyed on the wire's LENGTH, not its ref.
// These three checks previously asserted the ref rule. Detail lives in
// tests/render/test_wire_colour.mjs; these guard the drawing.
const wire = (holes, extra = {}) => ({
  ref: 'W1', from: { col: 0, row: 0 }, to: { col: holes, row: 0 }, ...extra,
});

s.check('A ONE-HOLE WIRE IS BROWN AND A NINE-HOLE ONE IS WHITE', () => {
  eq(C.wireColour(wire(1)), C.COLOUR_CODE[1].hex, '1 hole brown');
  eq(C.wireColour(wire(9)), C.COLOUR_CODE[9].hex, '9 holes white');
  eq(C.wireColour(wire(5)), C.COLOUR_CODE[5].hex, '5 holes green');
});

s.check('THE LENGTH NAMES THE COLOUR, SO IT WRAPS AT TEN', () => {
  eq(C.wireColour(wire(10)), C.COLOUR_CODE[0].hex, '10 holes black');
  eq(C.wireColour(wire(23)), C.COLOUR_CODE[3].hex, '23 holes orange');
});

s.check('an explicit colour on the wire wins', () => {
  eq(C.wireColour(wire(3, { colour: '#ff00ff' })), '#ff00ff', 'override');
});

s.check('a malformed wire still gets a colour rather than nothing', () => {
  ok(C.wireColour({ ref: 'GND' }), 'a colour came back');
  ok(C.wireColour({}), 'even with no ends');
});

// ------------------------------------------------------------ drawing

// Wires of DIFFERENT LENGTHS, since length is what the colour encodes. The
// earlier version of this helper drew every wire the same length, so all three
// were correctly the same colour and the check looked broken when it was not.
function withWires(lengths) {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  lengths.forEach((len, i) => p.wires.push({
    ref: `W${i + 1}`, from: { col: 0, row: i }, to: { col: len, row: i },
  }));
  return p;
}

s.check('each wire is drawn in the colour for its own length', () => {
  const svg = R.renderBoard(withWires([1, 2, 3]), {});
  const strokes = els(svg, 'wire').map((e) => attr(e, 'stroke'));
  eq(strokes, [C.COLOUR_CODE[1].hex, C.COLOUR_CODE[2].hex, C.COLOUR_CODE[3].hex], 'strokes');
});

s.check('EVERY WIRE HAS A CASING, SO BLACK AND WHITE BOTH SURVIVE', () => {
  // A black wire on the dark board and a white one on the light board would each
  // vanish without it.
  for (const theme of ['light', 'dark']) {
    const svg = R.renderBoard(withWires(['W10', 'W9']), { theme });
    const casings = els(svg, 'wire-casing');
    eq(casings.length, 2, `${theme}: one casing per wire`);
    const wires = els(svg, 'wire');
    for (let i = 0; i < 2; i += 1) {
      ok(Number(attr(casings[i], 'stroke-width')) > Number(attr(wires[i], 'stroke-width')),
        `${theme}: casing ${i} is wider than its wire`);
    }
  }
});

s.check('the casing is painted before the wire, not over it', () => {
  const svg = R.renderBoard(withWires(['W1']), {});
  ok(svg.indexOf('data-kind="wire-casing"') < svg.indexOf('data-kind="wire"'), 'order');
});

s.check('an overridden wire colour reaches the drawing', () => {
  const p = withWires(['W1']);
  p.wires[0].colour = '#ff00ff';
  eq(attr(els(R.renderBoard(p, {}), 'wire')[0], 'stroke'), '#ff00ff', 'stroke');
});

s.check("A PART'S SILK COLOUR REACHES ITS BODY", () => {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 4,
    at: { col: 2, row: 2 }, rot: 0, silk: '#00a0a0' });
  const body = els(R.renderBoard(p, {}), 'part-body')[0];
  eq(attr(body, 'stroke'), '#00a0a0', 'body stroke');
});

s.check('a part with no silk colour is unchanged', () => {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 4, at: { col: 2, row: 2 }, rot: 0 });
  const body = els(R.renderBoard(p, {}), 'part-body')[0];
  eq(attr(body, 'stroke'), R.THEMES.light.silk, 'theme silk');
});

s.check('THE SILK COLOUR PAINTS THE PADS TOO', () => {
  // Corrected 2026-08-30. This check originally asserted the opposite — that
  // pads keep the theme colour so a part could not make its own pads
  // unreadable. That was my invention, not the model: a pad is a SILKSCREEN
  // marking rather than copper, so a part's silkscreen colour has to paint it.
  // Legibility is the user's choice, and it is one they can undo.
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 4,
    at: { col: 2, row: 2 }, rot: 0, silk: '#00a0a0' });
  for (const pad of els(R.renderBoard(p, {}), 'pad')) {
    eq(attr(pad, 'stroke'), '#00a0a0', 'pad takes the part silk colour');
  }
});

// ------------------------------------------------- telling segments apart

s.check('AN UNCUT ROW IS ONE SHADE — an uncut board looks as it did', () => {
  const p = boardm.makeProject({ cols: 12, rows: 4 });
  const fills = new Set(els(R.renderBoard(p, {}), 'copper').map((e) => attr(e, 'fill')));
  eq(fills.size, 1, 'one fill across the whole board');
});

s.check('A ROW CUT ONCE DRAWS ITS TWO HALVES DIFFERENTLY', () => {
  // Two segments of one row reading as one strip is the most expensive
  // misreading this tool can cause: it is the difference between a working
  // circuit and a short.
  const p = boardm.makeProject({ cols: 12, rows: 4 });
  p.breaks.push({ row: 1, x: 5, at: 'gap' });
  const row1 = els(R.renderBoard(p, {}), 'copper')
    .filter((e) => attr(e, 'data-seg').startsWith('s:1:'));
  eq(row1.length, 2, 'two segments');
  ok(attr(row1[0], 'fill') !== attr(row1[1], 'fill'), 'and they differ');
});

s.check('three segments alternate rather than drifting', () => {
  const p = boardm.makeProject({ cols: 15, rows: 4 });
  p.breaks.push({ row: 1, x: 4, at: 'gap' }, { row: 1, x: 9, at: 'gap' });
  const fills = els(R.renderBoard(p, {}), 'copper')
    .filter((e) => attr(e, 'data-seg').startsWith('s:1:'))
    .map((e) => attr(e, 'fill'));
  eq(fills.length, 3, 'three segments');
  eq(fills[0], fills[2], 'the first and third match');
  ok(fills[0] !== fills[1], 'and the middle one differs');
});

s.check('the difference is a hint, not a stripe', () => {
  const a = C.segmentShade('#b87333', 0);
  const b = C.segmentShade('#b87333', 1);
  ok(a !== b, 'they differ');
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const delta = Math.max(...rgb(a).map((v, i) => Math.abs(v - rgb(b)[i])));
  ok(delta > 4 && delta < 48, `channel delta ${delta}: visible but not a stripe`);
});

s.check('a highlighted net is not shaded, so highlight stays unambiguous', () => {
  const p = boardm.makeProject({ cols: 12, rows: 4 });
  p.breaks.push({ row: 1, x: 5, at: 'gap' });
  const { nets } = R.netsFor(p);
  const svg = R.renderBoard(p, { highlightNet: nets[0].id });
  const lit = els(svg, 'copper').filter((e) => attr(e, 'data-highlight') === 'true');
  eq(new Set(lit.map((e) => attr(e, 'fill'))).size, 1, 'one highlight colour');
});

// -------------------------------------------------------------- escape

s.check('ESCAPE ARMS THE SELECT TOOL', () => {
  eq(C.TOOL_AFTER_ESCAPE, 'select', 'the tool Escape returns to');
});

s.check('silk is an editable field on a part', () => {
  ok(E.editableFields(lib.getPart('res-axial')).includes('silk'), 'resistor offers silk');
  const { placement, error } = E.applyPlacementEdit(
    { ref: 'R1', part: 'res-axial', span: 4, at: { col: 1, row: 1 }, rot: 0 },
    lib.getPart, 'silk', '#123456',
  );
  ok(!error, 'accepted');
  eq(placement.silk, '#123456', 'applied');
});

s.check('a library default sits between the placement and the theme', () => {
  eq(C.silkOf({ silk: '#111111' }, { silk: '#222222' }, '#333333'), '#111111', 'placement wins');
  eq(C.silkOf({}, { silk: '#222222' }, '#333333'), '#222222', 'then the part');
  eq(C.silkOf({}, {}, '#333333'), '#333333', 'then the theme');
});

process.exit((await s.run()) ? 0 : 1);
