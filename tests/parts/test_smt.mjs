// Checks for copper-side mounting and the SMT 0603.
// Governed by docs/specs/cuts-and-mounting.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const lib = await softImport('../../src/parts/library.js', here);
const drcm = await softImport('../../src/net/drc.js', here);
const R = await softImport('../../src/render/svg.js', here);
const V = await softImport('../../src/model/views.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('smt');

const els = (svg, kind) => [...String(svg).matchAll(
  new RegExp(`<[^>]*data-kind="${kind}"[^>]*>`, 'g'),
)].map((m) => m[0]);
const attr = (el, name) => {
  const m = el.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
};

const B = { cols: 12, rows: 4, pattern: 'strip' };

s.check('the library has an 0603 chip part', () => {
  ok(lib.hasPart('smt-0603'), 'smt-0603 exists');
});

s.check('it is a copper-side part with two poles one hole apart', () => {
  const p = lib.getPart('smt-0603');
  eq(p.side, 'copper', 'side');
  const pins = lib.pinsOf(p);
  eq(pins.length, 2, 'two poles');
  eq([pins[1].dx - pins[0].dx, pins[1].dy - pins[0].dy], [1, 0], 'one hole apart along a strip');
});

s.check('a through-hole part is top-side by default', () => {
  eq(lib.getPart('res-axial').side ?? 'top', 'top', 'res-axial side');
});

s.check('AN SMT PAD SHARING A HOLE WITH A LEAD IS NOT A COLLISION', () => {
  // The chip is on the copper underside; the hole above it is still free.
  const codes = drcm.drc(B, [{ row: 0, x: 4, at: 'gap' }], [
    { ref: 'C1', part: 'smt-0603', at: { col: 4, row: 0 }, rot: 0 },
    { ref: 'R1', part: 'res-axial', span: 2, at: { col: 4, row: 0 }, rot: 90 },
  ], lib.getPart, []).map((f) => f.code);
  ok(!codes.includes('hole-collision'), 'no collision between a pad and a lead');
});

s.check('two through-hole leads in one hole still collide', () => {
  const codes = drcm.drc(B, [], [
    { ref: 'R1', part: 'res-axial', span: 2, at: { col: 4, row: 0 }, rot: 0 },
    { ref: 'R2', part: 'res-axial', span: 2, at: { col: 6, row: 0 }, rot: 0 },
  ], lib.getPart, []).map((f) => f.code);
  ok(codes.includes('hole-collision'), 'the ordinary case is unaffected');
});

s.check('AN 0603 WITH NO CUT BETWEEN ITS POLES IS AN ERROR THAT NAMES THE CUT', () => {
  const findings = drcm.drc(B, [],
    [{ ref: 'C1', part: 'smt-0603', at: { col: 4, row: 1 }, rot: 0 }], lib.getPart, []);
  const f = findings.find((x) => x.code === 'missing-required-break');
  ok(f, 'missing-required-break is raised');
  eq(f.severity, 'error', 'and it is an error');
  ok(/\b4\b/.test(f.message) && /\b5\b/.test(f.message),
    `the message names the holes to cut between: ${f.message}`);
});

s.check('...and cutting between them clears it', () => {
  const codes = drcm.drc(B, [{ row: 1, x: 4, at: 'gap' }],
    [{ ref: 'C1', part: 'smt-0603', at: { col: 4, row: 1 }, rot: 0 }], lib.getPart, [])
    .map((x) => x.code);
  ok(!codes.includes('missing-required-break'), 'cleared');
  ok(!codes.includes('short-across-part'), 'and not reported as a plain short either');
});

s.check('a spot-face between the poles clears it too', () => {
  const codes = drcm.drc(B, [{ row: 1, x: 4, at: 'hole' }],
    [{ ref: 'C1', part: 'smt-0603', at: { col: 4, row: 1 }, rot: 0 }], lib.getPart, [])
    .map((x) => x.code);
  ok(!codes.includes('missing-required-break'), 'cleared by a spot-face too');
});

s.check('an 0603 joins nothing — it is a component, not a link', () => {
  const p = boardm.makeProject({ cols: 12, rows: 4 });
  p.breaks.push({ row: 1, x: 4, at: 'gap' });
  p.placements.push({ ref: 'C1', part: 'smt-0603', at: { col: 4, row: 1 }, rot: 0 });
  const { segmentNet } = V.netsFor(p);
  ok(segmentNet['s:1:0'] !== segmentNet['s:1:1'],
    'the two halves of the cut strip stay separate nets');
});

// ------------------------------------------------------------------ drawing

function withChip() {
  const p = boardm.makeProject({ cols: 12, rows: 4 });
  p.breaks.push({ row: 1, x: 4, at: 'gap' });
  p.placements.push({ ref: 'C1', part: 'smt-0603', at: { col: 4, row: 1 }, rot: 0 });
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 2, at: { col: 8, row: 0 }, rot: 90 });
  return p;
}

s.check('THE UNDERSIDE VIEW DRAWS THE CHIP, BECAUSE THAT IS WHERE IT IS', () => {
  const svg = R.renderBoard(withChip(), { view: 'underside' });
  const bodies = els(svg, 'part-body');
  ok(bodies.length > 0, 'a body is drawn underside');
  const grp = String(svg).split('data-kind="part"').find((chunk) => chunk.includes('C1'));
  ok(grp, 'the chip group is present underside');
});

s.check('the underside view still drops top-side bodies', () => {
  const svg = R.renderBoard(withChip(), { view: 'underside' });
  // R1 is through-hole: its body must not be drawn on the solder side.
  const after = String(svg).slice(String(svg).indexOf('data-ref="R1"'));
  const upTo = after.slice(0, after.indexOf('</g>'));
  ok(!upTo.includes('data-kind="part-body"'), 'R1 has no body underside');
});

s.check('the top view ghosts the chip rather than hiding it', () => {
  const svg = R.renderBoard(withChip(), { view: 'top' });
  const chip = els(svg, 'part').find((e) => attr(e, 'data-ref') === 'C1');
  ok(chip, 'the chip is present on the top view');
  eq(attr(chip, 'data-side'), 'copper', 'and it is marked as a copper-side part');
});

// -------------------------------------------- the drawing is a land, not a chip
// Governed by docs/specs/smt-land-pattern.md

const G = await softImport('../../src/model/geometry.js', here);

// The <g> the chip's body is drawn inside, and the first rect in it.
function chipBody() {
  const svg = String(R.renderBoard(withChip(), { view: 'underside' }));
  const chunk = svg.slice(svg.indexOf('data-ref="C1"'));
  const body = chunk.slice(0, chunk.indexOf('</g>'));
  const num = (name) => Number((body.match(new RegExp(`${name}="(-?[\\d.]+)"`)) ?? [])[1]);
  return { body, w: num('width'), h: num('height') };
}

s.check('THE LAND REACHES ACROSS BOTH THROUGH HOLES', () => {
  // It used to be drawn at the chip's true 1.6 x 0.8 mm. That was accurate and
  // invisible: 0.8 mm of translucent silk on a 2.0 mm strip, over copper, holes
  // and a cut. A part you cannot see is not on the drawing.
  //
  // The pins are one pitch apart, so the ends land on the OUTER EDGES of the
  // two holes: pins at +-1.27, holes 1.0 across, rectangle finishing at +-1.77.
  const { w } = chipBody();
  ok(w > G.PITCH_MM, `${w} mm reaches past both hole centres (${G.PITCH_MM} mm apart)`);
  ok(w <= G.PITCH_MM + G.HOLE_DIA_MM + 0.01,
    `and stops at their outer edges, not beyond: ${w} <= ${G.PITCH_MM + G.HOLE_DIA_MM}`);
});

s.check('AND IS A LITTLE NARROWER THAN THE COPPER STRIP', () => {
  // Narrower, so the copper shows either side and the part cannot be mistaken
  // for the track. But not much narrower, which is what made it invisible.
  const { h } = chipBody();
  ok(h < G.TRACK_W_MM, `${h} < the ${G.TRACK_W_MM} mm track`);
  ok(h > G.TRACK_W_MM * 0.6, `and fills most of it: ${h} > ${G.TRACK_W_MM * 0.6}`);
});

s.check('it has a termination at each end, where the solder goes', () => {
  // What makes it read as a two-terminal part rather than a plain box.
  const { body } = chipBody();
  const filled = [...body.matchAll(/<rect[^>]*fill="(?!none)[^"]*"[^>]*>/g)];
  ok(filled.length >= 2, `two terminations: found ${filled.length}`);
});

s.check('the land is derived from the board, not from a size in the library', () => {
  // Data nothing reads is the drift this project has paid for twice.
  const p = lib.getPart('smt-0603');
  eq(p.body.lenMm, undefined, 'no lenMm');
  eq(p.body.widMm, undefined, 'no widMm');
});

process.exit((await s.run()) ? 0 : 1);
