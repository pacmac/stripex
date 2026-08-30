// A net name has to be readable where it lands: on a strip full of holes.
// Governed by docs/specs/net-name-plate.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const B = await softImport('../../src/model/board.js', here);
const G = await softImport('../../src/model/geometry.js', here);

const s = suite('net-name-plate');

// A plain board with one named net. Row 3 is uncut, so it is a single segment
// spanning every column — the case where the name lies over the most holes.
function board(name = 'GND', extra = {}) {
  return {
    ...B.makeProject({ cols: 25, rows: 20 }),
    netLabels: { '4,3': { name, colour: '#1c1c1c' } },
    ...extra,
  };
}

const svg = (project, opts = {}) => R.renderBoard(project, opts);

// The index of the LAST hole in the document, and of the plate. Ordering in an
// SVG string is z-order: later is on top.
const lastHoleAt = (out) => out.lastIndexOf('data-kind="hole"');
const plateAt = (out) => out.indexOf('data-kind="net-name-plate"');
const textAt = (out) => out.indexOf('data-kind="net-name"');

// The space is load-bearing: without it `opacity` matches inside
// `stroke-opacity`, and the plate reads as 0.22 transparent when it is opaque.
const attr = (tag, key) => {
  const m = new RegExp(`\\s${key}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

// The whole element containing `from` — from ITS opening angle bracket, so a
// fill on the element before it cannot be read as this one's.
const tagAt = (out, from) => out.slice(out.lastIndexOf('<', from), out.indexOf('>', from) + 1);

// ------------------------------------------------- the defect: the draw order

s.check('THE PLATE IS DRAWN AFTER EVERY HOLE', () => {
  // This is the bug. The name was emitted inside the copper pass, step 2, and
  // the holes are step 4 — so each hole was painted over the letters.
  const out = svg(board());
  ok(plateAt(out) > -1, 'a plate is drawn at all');
  ok(plateAt(out) > lastHoleAt(out),
    `the plate (at ${plateAt(out)}) comes after the last hole (at ${lastHoleAt(out)})`);
});

s.check('AND SO IS THE TEXT', () => {
  const out = svg(board());
  ok(textAt(out) > lastHoleAt(out), 'the name comes after the last hole');
  ok(textAt(out) > plateAt(out), 'and sits on top of its own plate');
});

s.check('the plate is immediately before its text', () => {
  const out = svg(board());
  const between = out.slice(out.indexOf('/>', plateAt(out)), textAt(out));
  ok(!between.includes('data-kind='), `nothing is drawn between them: ${between.slice(0, 80)}`);
});

s.check('THE NAME IS THE TOP LAYER — A WIRE DOES NOT COVER IT', () => {
  // This reverses what net-name-plate.md first argued. That reasoning suits a
  // photograph of a finished board; in a layout editor the names are what you
  // read the board BY, and a caption you have to move something to see has
  // stopped working.
  const out = svg(board('GND', { wires: [{ ref: 'A', kind: 'link', from: { col: 2, row: 3 }, to: { col: 2, row: 8 } }] }));
  const wire = out.lastIndexOf('data-kind="wire');
  ok(wire > -1, 'the wire is drawn');
  ok(plateAt(out) > wire, `the plate (${plateAt(out)}) is above the wire (${wire})`);
});

s.check('NOR DOES A COMPONENT SITTING ACROSS THE STRIP', () => {
  // The case that argued for parts on top is the case where the name matters
  // most: a DIP across a labelled strip is exactly where it vanished.
  const out = svg(board('GND', {
    placements: [{ ref: 'U1', part: 'dip', at: { col: 2, row: 2 }, rot: 0, span: 7, width: 3 }],
  }));
  const body = out.lastIndexOf('data-kind="part');
  ok(body > -1, 'the DIP is drawn');
  ok(plateAt(out) > body, `the plate (${plateAt(out)}) is above the part (${body})`);
});

s.check('and a check marker does not either', () => {
  const out = svg(board('GND', {
    placements: [{ ref: 'U1', part: 'dip', at: { col: 2, row: 2 }, rot: 0, span: 7, width: 3 }],
  }), { findings: [{ code: 'x', severity: 'error', holes: [{ col: 4, row: 3 }] }] });
  const drc = out.lastIndexOf('data-kind="drc"');
  ok(drc > -1, 'the marker is drawn');
  ok(plateAt(out) > drc, `the plate (${plateAt(out)}) is above the marker (${drc})`);
});

s.check('BUT NOT OVER THE PIN YOU ARE MOVING', () => {
  // The move handle is drawn last on purpose, so nothing covers the pin being
  // dragged. A pill over it would be the same defect in a new place.
  const out = svg(board(), { moveAnchor: { col: 4, row: 3, ref: 'U1', pin: '1' } });
  const handle = out.indexOf('data-kind="move-anchor"');
  ok(handle > -1, 'the handle is drawn');
  ok(handle > plateAt(out), `the handle (${handle}) is above the plate (${plateAt(out)})`);
});

s.check('and hit targets stay clickable above it', () => {
  // Invisible rectangles that exist to be clicked; the name is
  // pointer-events="none", so this costs nothing you can see.
  const p = board('GND', { breaks: [{ row: 3, x: 8, at: 'gap' }] });
  const out = svg(p);
  const hit = out.lastIndexOf('data-kind="break-hit"');
  ok(hit > -1, 'a hit target is drawn');
  ok(hit > plateAt(out), 'after the plate');
});

// ------------------------------------------------------------ it is opaque

s.check('THE PLATE IS OPAQUE ON THE TOP VIEW', () => {
  // Where the copper itself is washed to 0.55 because it is under the board.
  // An 0.55 plate would let the holes back through, which is the defect.
  const out = svg(board(), { view: 'top' });
  ok(plateAt(out) > -1, 'there is a plate to be opaque');
  const o = attr(tagAt(out, plateAt(out)), 'opacity');
  ok(o === null || Number(o) === 1, `no transparency: opacity=${o}`);
});

s.check('and on the underside too', () => {
  const out = svg(board(), { view: 'bottom' });
  ok(plateAt(out) > -1, 'there is a plate on the underside view');
  const o = attr(tagAt(out, plateAt(out)), 'opacity');
  ok(o === null || Number(o) === 1, `opacity=${o}`);
});

s.check('THE INK IS CHOSEN AGAINST THE PLATE IT SITS ON', () => {
  // The point of an opaque plate, beyond hiding the holes: readableOn was
  // already being asked about a colour that was not on screen, because the
  // strip was blended with the substrate at 0.55.
  const out = svg(board());
  const plate = tagAt(out, plateAt(out));
  const ground = attr(plate, 'fill');
  const ink = attr(tagAt(out, textAt(out)), 'fill');
  eq(ink, R.readableOn(ground, R.THEMES.light), 'the ink is readable on the plate');
});

s.check('a black net is not written in black on black', () => {
  const out = svg(board());
  const plate = tagAt(out, plateAt(out));
  eq(attr(plate, 'fill'), '#1c1c1c', 'the plate takes the net colour');
  ok(attr(plate, 'fill') !== R.readableOn('#1c1c1c', R.THEMES.light), 'and the ink differs');
});

// --------------------------------------------------------------- it fits

s.check('A NAME ON A STRIP THAT REACHES AN EDGE GOES OUTSIDE THE BOARD', () => {
  // Peter: "if a net name extends to either the righ or left edge of the board,
  // then move the net name just to the right or left of the actual board." A
  // rail runs the full width and its name sat in the middle of it, on top of the
  // parts and holes you are trying to read.
  const p = board('GND');                       // row 3 uncut: full width
  const out = svg(p);
  const plate = tagAt(out, plateAt(out));
  const x = Number(attr(plate, 'x'));
  const boardW = G.PITCH_MM * 25;
  ok(x >= boardW || x + Number(attr(plate, 'width')) <= 0,
    `the plate is off the board, not on it: x=${x} against a ${boardW} mm board`);
});

s.check('but a strip in the middle keeps its name on it', () => {
  // Only when the segment actually TOUCHES an edge. A short strip in the middle
  // has no edge to go to.
  const p = board('MID', { breaks: [
    { row: 3, x: 3, at: 'gap' }, { row: 3, x: 9, at: 'gap' },
  ] });
  // The label anchor 4,3 is on the middle segment, cols 4..9.
  const out = svg(p);
  const plate = tagAt(out, plateAt(out));
  const x = Number(attr(plate, 'x'));
  const boardW = G.PITCH_MM * 25;
  ok(x > 0 && x < boardW, `still on the board: x=${x}`);
});

s.check('THE PLATE NEVER POKES OUT OF ITS STRIP', () => {
  const out = svg(board());
  const h = Number(attr(tagAt(out, plateAt(out)), 'height'));
  ok(h > 0, 'it has a height');
  ok(h <= G.TRACK_W_MM,
    `${h} fits inside the ${G.TRACK_W_MM} mm track, so it cannot look like copper bridging two rows`);
});

s.check('and never wider than the segment it names', () => {
  // A one-hole stub: row 3 cut on both sides of column 4, which is the hole the
  // label is anchored to. A single letter fits there, so it must be drawn — and
  // it must be drawn inside the 2.0 mm of copper that exists.
  const p = board('V', { breaks: [
    { row: 3, x: 3, at: 'gap' }, { row: 3, x: 4, at: 'gap' },
  ] });
  const out = svg(p);
  ok(plateAt(out) > -1, 'the stub is labelled');
  const w = Number(attr(tagAt(out, plateAt(out)), 'width'));
  const segW = G.PITCH_MM - G.TRACK_GAP_MM;
  ok(w <= segW + 0.01, `${w} fits the one-hole segment (${segW} mm)`);
});

// ----------------------------------------------------- the sizing arithmetic

s.check('namePlate sizes a plate around the text', () => {
  const base = G.PITCH_MM * 0.55;
  const r = R.namePlate('GND', 40, base);
  ok(r.show, 'a name on a wide segment shows');
  eq(r.fontSize, base, 'at full size');
  ok(r.w > base * 3 * 0.6, `wide enough for three letters: ${r.w}`);
  ok(r.h <= G.TRACK_W_MM, 'and inside the track');
});

s.check('THE NAME HAS CLEAR SPACE AT EACH END', () => {
  // Peter: "needs a little bit of left / right padding at start / end". In EM,
  // so it survives the font shrinking to fit a short segment — which is exactly
  // where the letters are already tightest against the ends.
  const base = G.PITCH_MM * 0.55;
  for (const [name, seg] of [['GND', 40], ['VCC', 2.5], ['5V', 8]]) {
    const r = R.namePlate(name, seg, base);
    ok(r.show, `${name} shows`);
    const text = 0.62 * r.fontSize * name.length;
    ok(r.w - text >= r.fontSize * 0.8,
      `${name}: ${(r.w - text).toFixed(2)} mm of padding around ${text.toFixed(2)} mm of text`);
  }
});

s.check('A LONG NAME SHRINKS RATHER THAN SPILLING', () => {
  // Spilling is the defect coming back: letters over the holes, now with a
  // plate pointing at them.
  const base = G.PITCH_MM * 0.55;
  const wide = R.namePlate('VCC', 40, base);
  // 2.5 mm is one hole of copper; three letters at full size need about 3.5.
  const tight = R.namePlate('VCC', 2.5, base);
  ok(tight.show, 'it still shows');
  ok(tight.fontSize < wide.fontSize, `it shrank: ${tight.fontSize} < ${wide.fontSize}`);
  ok(tight.w <= 2.5 + 0.01, `and fits: ${tight.w} <= 2.5`);
});

s.check('and vanishes rather than shrinking past legibility', () => {
  const base = G.PITCH_MM * 0.55;
  const r = R.namePlate('POWER-GROUND-RETURN', 2.54, base);
  ok(!r.show, 'a nineteen-character name on one hole is dropped');
});

s.check('the name still appears on the net s other segments', () => {
  // Dropping one caption is only safe because the name is drawn on every
  // segment of the net.
  const p = board('POWER-GROUND-RETURN', { breaks: [{ row: 3, x: 0, at: 'gap' }] });
  const out = svg(p);
  ok(out.includes('POWER-GROUND-RETURN'), 'the long run keeps its name');
});

// ------------------------------------------------------------- its own layer

s.check('NET NAMES ARE THEIR OWN LAYER', () => {
  eq(R.DEFAULT_LAYERS.netNames, true, 'on by default, so an old project opens with them');
});

s.check('switching the layer off removes plate and text', () => {
  const out = svg(board(), { layers: { netNames: false } });
  eq(plateAt(out), -1, 'no plate');
  eq(textAt(out), -1, 'no name');
});

s.check('A REF IS NOT A NET NAME', () => {
  // They rode the same switch. Turning off R1 and 10k must not silently take
  // every net caption with it.
  const out = svg(board(), { layers: { labels: false } });
  ok(plateAt(out) > -1, 'the net name survives labels:false');
});

s.check('and turning off net names leaves the part refs alone', () => {
  const p = board('GND', {
    placements: [{ ref: 'R1', part: 'res-axial', at: { col: 1, row: 10 }, rot: 0, span: 4 }],
  });
  const out = svg(p, { layers: { netNames: false } });
  ok(out.includes('data-kind="part-label"'), 'R1 is still drawn');
});

// -------------------------------------------------------- nothing to draw

s.check('an unnamed net draws neither plate nor text', () => {
  const out = svg(B.makeProject({ cols: 25, rows: 20 }));
  eq(plateAt(out), -1, 'no plate');
  eq(textAt(out), -1, 'no name');
});

s.check('an empty name is not a name', () => {
  const out = svg(board(''));
  eq(plateAt(out), -1, 'no plate for an empty string');
});

process.exit((await s.run()) ? 0 : 1);
