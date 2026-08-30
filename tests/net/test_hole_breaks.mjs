// Checks for the spot-face cut — a break AT a hole, which kills the hole.
// Governed by docs/specs/cuts-and-mounting.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const seg = await softImport('../../src/net/segments.js', here);
const drcm = await softImport('../../src/net/drc.js', here);
const lib = await softImport('../../src/parts/library.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('hole-breaks');

const B = { cols: 10, rows: 3, pattern: 'strip' };
const row0 = (breaks) => seg.segments(B, breaks)
  .filter((g) => g.row === 0)
  .map((g) => [g.x0, g.x1]);

s.check('no breaks gives one full-width segment', () => {
  eq(row0([]), [[0, 9]], 'row 0');
});

s.check('a gap break keeps both its holes', () => {
  eq(row0([{ row: 0, x: 4, at: 'gap' }]), [[0, 4], [5, 9]], 'gap at 4');
});

s.check('AN ABSENT at STILL MEANS A KNIFE CUT BETWEEN HOLES', () => {
  // Every project saved before this change must keep its meaning.
  eq(row0([{ row: 0, x: 4 }]), [[0, 4], [5, 9]], 'no at field');
});

s.check('A SPOT-FACE CUT KILLS ITS OWN HOLE', () => {
  eq(row0([{ row: 0, x: 4, at: 'hole' }]), [[0, 3], [5, 9]], 'hole 4 is in neither segment');
});

s.check('a spot-face at the left edge leaves no empty segment', () => {
  eq(row0([{ row: 0, x: 0, at: 'hole' }]), [[1, 9]], 'one segment only');
});

s.check('a spot-face at the right edge leaves no empty segment', () => {
  eq(row0([{ row: 0, x: 9, at: 'hole' }]), [[0, 8]], 'one segment only');
});

s.check('two adjacent spot-faces kill both holes and leave no gap segment', () => {
  eq(row0([{ row: 0, x: 4, at: 'hole' }, { row: 0, x: 5, at: 'hole' }]),
    [[0, 3], [6, 9]], 'holes 4 and 5 both dead');
});

s.check('a spot-face may sit at the last column, which a knife cut may not', () => {
  ok(row0([{ row: 0, x: 9, at: 'hole' }]).length > 0, 'hole break at cols-1 is legal');
  let threw = false;
  try { seg.segments(B, [{ row: 0, x: 9, at: 'gap' }]); } catch { threw = true; }
  ok(threw, 'gap break at cols-1 is still rejected');
});

s.check('a spot-face beyond the last column is rejected', () => {
  let threw = false;
  try { seg.segments(B, [{ row: 0, x: 10, at: 'hole' }]); } catch { threw = true; }
  ok(threw, 'hole break at cols is rejected');
});

s.check('a dead hole belongs to no segment in the index', () => {
  const segs = seg.segments(B, [{ row: 1, x: 6, at: 'hole' }]);
  const idx = seg.segmentIndex(segs);
  eq(idx.get('6,1'), undefined, 'the spot-faced hole maps to nothing');
  ok(idx.get('5,1'), 'its left neighbour still maps');
  ok(idx.get('7,1'), 'its right neighbour still maps');
});

s.check('a spot-face splits one strip into two independent nets', () => {
  const before = seg.segments(B, []).length;
  const after = seg.segments(B, [{ row: 2, x: 5, at: 'hole' }]).length;
  eq(after, before + 1, 'one more segment');
});

s.check('A LEAD IN A DEAD HOLE WARNS RATHER THAN ERRORS', () => {
  // Sometimes deliberate: a leg that is only mechanical support.
  const findings = drcm.drc(B, [{ row: 0, x: 3, at: 'hole' }],
    [{ ref: 'R1', part: 'res-axial', span: 3, at: { col: 3, row: 0 }, rot: 0 }],
    lib.getPart, []);
  const dead = findings.filter((f) => f.code === 'pin-on-dead-hole');
  ok(dead.length > 0, 'pin-on-dead-hole is raised');
  eq(dead[0].severity, 'warning', 'and it is a warning, not an error');
});

s.check('a spot-face clears a short the same way a knife cut does', () => {
  const codes = (breaks) => drcm.drc(B, breaks,
    [{ ref: 'R1', part: 'res-axial', span: 4, at: { col: 1, row: 0 }, rot: 0 }],
    lib.getPart, []).map((f) => f.code);
  ok(codes([]).includes('short-across-part'), 'shorted with no cut');
  ok(!codes([{ row: 0, x: 3, at: 'hole' }]).includes('short-across-part'), 'cleared by spot-face');
});

s.check('validateProject accepts both cut types and rejects a bad one', () => {
  const make = (br) => ({
    schema: 'stripex/1', board: B, breaks: [br], placements: [], wires: [],
  });
  eq(boardm.validateProject(make({ row: 0, x: 4, at: 'gap' })), [], 'gap is valid');
  eq(boardm.validateProject(make({ row: 0, x: 9, at: 'hole' })), [], 'hole at cols-1 is valid');
  ok(boardm.validateProject(make({ row: 0, x: 9, at: 'gap' })).length > 0,
    'gap at cols-1 is rejected');
  ok(boardm.validateProject(make({ row: 0, x: 4, at: 'sawn' })).length > 0,
    'an unknown cut type is rejected');
});

// ----------------------------------------------- how big the mark is drawn
// Governed by docs/specs/spot-drill-circle-size.md

const R = await softImport('../../src/render/svg.js', here);
const geom = await softImport('../../src/model/geometry.js', here);

const drawn = (breaks) => String(R.renderBoard({
  schema: 'stripex/1', board: { cols: 10, rows: 4, pattern: 'strip' },
  breaks, placements: [], wires: [],
}, {}));
const tagOf = (svg, re) => (re.exec(svg) ?? [''])[0];
const attrOf = (tag, name) => Number((new RegExp(`${name}="(-?[\\d.]+)"`).exec(tag) ?? [])[1]);

s.check('A SPOT-FACE MARK IS NARROWER THAN THE HOLE PITCH', () => {
  // It was 0.56 of the pitch — 2.84 mm across on a 2.54 mm pitch — so it lapped
  // over its neighbours and a row of them merged into a bar. The comment
  // defended it as the size of the CUTTER, which is true and is not what the
  // mark is: it says "this hole is dead", it is not a picture of the tool.
  const svg = drawn([{ row: 1, x: 4, at: 'hole' }]);
  const r = attrOf(tagOf(svg, /<circle data-kind="break"[^>]*data-at="hole"[^>]*>/), 'r');
  ok(r > 0, 'a mark is drawn');
  ok(r * 2 < geom.PITCH_MM,
    `${(r * 2).toFixed(2)} mm across on a ${geom.PITCH_MM} mm pitch`);
});

s.check('and still far wider than the hole it kills', () => {
  // Or it would read as a pad rather than as absent copper.
  const svg = drawn([{ row: 1, x: 4, at: 'hole' }]);
  const r = attrOf(tagOf(svg, /<circle data-kind="break"[^>]*data-at="hole"[^>]*>/), 'r');
  ok(r * 2 >= geom.HOLE_DIA_MM * 2,
    `${(r * 2).toFixed(2)} mm against a ${geom.HOLE_DIA_MM} mm hole`);
});

s.check('two on adjacent holes do not touch', () => {
  const svg = drawn([{ row: 1, x: 4, at: 'hole' }, { row: 1, x: 5, at: 'hole' }]);
  const marks = [...svg.matchAll(/<circle data-kind="break"[^>]*data-at="hole"[^>]*>/g)]
    .map((m) => ({ cx: attrOf(m[0], 'cx'), r: attrOf(m[0], 'r') }));
  eq(marks.length, 2, 'two marks');
  const gap = Math.abs(marks[0].cx - marks[1].cx) - (marks[0].r + marks[1].r);
  ok(gap > 0, `${gap.toFixed(2)} mm of daylight between them`);
});

s.check('the hit target still covers the hole itself', () => {
  // NOT "as big as the mark". The target is deliberately pad-sized — see
  // break-hit-targets.md — because full-size targets made 44% of a DIL body
  // select a cut instead of the chip. So the outer ring of a spot-face is not
  // clickable, and that is a trade made on purpose.
  //
  // What must hold is that the HOLE is: the middle of the mark is where anyone
  // aims, and it is the only part of it that is unambiguously this cut.
  const svg = drawn([{ row: 1, x: 4, at: 'hole' }]);
  const mark = tagOf(svg, /<circle data-kind="break"[^>]*data-at="hole"[^>]*>/);
  const hit = tagOf(svg, /<[^>]*data-kind="break-hit"[^>]*>/);
  ok(hit, 'a hit target is drawn');
  const hr = attrOf(hit, 'r') || attrOf(hit, 'width') / 2;
  ok(hr * 2 >= geom.HOLE_DIA_MM, `${(hr * 2).toFixed(2)} mm covers a ${geom.HOLE_DIA_MM} mm hole`);
  // And it is on the same spot, which is the part that would silently rot.
  const hx = attrOf(hit, 'cx') || attrOf(hit, 'x') + hr;
  ok(Math.abs(hx - attrOf(mark, 'cx')) < 0.01, 'and is centred on the mark');
});

process.exit((await s.run()) ? 0 : 1);
