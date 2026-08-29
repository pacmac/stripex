// Checks for the pure SVG renderer.
// Governed by docs/specs/editor-ui.md
//
// These run in node with no browser, which is only possible because renderBoard
// is a pure string-returning function. That is the point of the split.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const board = await softImport('../../src/model/board.js', here);
const geom = await softImport('../../src/model/geometry.js', here);

const s = suite('render');

// --- tiny attribute reader, so the checks assert on structure not on layout ---
const els = (svg, kind) => [...String(svg).matchAll(
  new RegExp(`<[^>]*data-kind="${kind}"[^>]*>`, 'g'),
)].map((m) => m[0]);
const attr = (el, name) => {
  const m = el.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const num = (el, name) => Number(attr(el, name));

function project() {
  const p = board.makeProject({ cols: 10, rows: 6, name: 'test' });
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 2, at: { col: 1, row: 0 }, rot: 90 });
  p.wires.push({ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 9, row: 5 } });
  return p;
}

s.check('renders an svg document', () => {
  const svg = R.renderBoard(project(), {});
  ok(typeof svg === 'string', 'returns a string');
  ok(svg.trimStart().startsWith('<svg'), 'starts with <svg');
  ok(svg.trimEnd().endsWith('</svg>'), 'ends with </svg>');
});

s.check('the viewBox is the board size in millimetres', () => {
  const p = project();
  const svg = R.renderBoard(p, {});
  const { w, h } = geom.boardSizeMm(p.board);
  ok(svg.includes(`viewBox="0 0 ${w} ${h}"`), `viewBox is 0 0 ${w} ${h}`);
});

s.check('one copper rect per strip segment', () => {
  const p = project();
  eq(els(R.renderBoard(p, {}), 'copper').length, 6, 'six uncut rows, six rects');
});

s.check('cutting a strip adds a copper rect', () => {
  const p = project();
  const before = els(R.renderBoard(p, {}), 'copper').length;
  p.breaks.push({ row: 2, x: 4 });
  eq(els(R.renderBoard(p, {}), 'copper').length, before + 1, 'one more segment');
});

s.check('copper is drawn at the track width, not the pitch', () => {
  const rect = els(R.renderBoard(project(), {}), 'copper')[0];
  eq(num(rect, 'height'), geom.TRACK_W_MM, 'copper rect height');
});

s.check('A BREAK IS DRAWN BETWEEN TWO HOLES, NOT ON ONE', () => {
  const p = project();
  p.breaks.push({ row: 2, x: 4 });
  const mark = els(R.renderBoard(p, {}), 'break')[0];
  ok(mark, 'a break marker exists');
  // The gap between hole 4 and hole 5 is centred on the boundary between them.
  const expected = (4 + 1) * geom.PITCH_MM;
  eq(num(mark, 'data-x'), expected, 'break marker x');
  ok(num(mark, 'data-x') !== geom.holeToMm(4, 2).x, 'and it is NOT on hole 4');
});

s.check('a break marker carries the row and gap it cuts', () => {
  const p = project();
  p.breaks.push({ row: 2, x: 4 });
  eq(attr(els(R.renderBoard(p, {}), 'break')[0], 'data-break'), '2,4', 'data-break');
});

s.check('every hole on the board is drawn and addressable', () => {
  const p = project();
  const holes = els(R.renderBoard(p, {}), 'hole');
  eq(holes.length, p.board.cols * p.board.rows, 'hole count');
  ok(holes.some((h) => attr(h, 'data-hole') === '0,0'), 'hole 0,0 is addressable');
  ok(holes.some((h) => attr(h, 'data-hole') === '9,5'), 'hole 9,5 is addressable');
});

s.check('A PEN WIRE IS DRAWN BETWEEN THE CENTRES OF ITS TWO HOLES', () => {
  const svg = R.renderBoard(project(), {});
  const wire = els(svg, 'wire')[0];
  ok(wire, 'a wire element exists');
  const a = geom.holeToMm(0, 0);
  const b = geom.holeToMm(9, 5);
  eq([num(wire, 'x1'), num(wire, 'y1')], [a.x, a.y], 'wire start');
  eq([num(wire, 'x2'), num(wire, 'y2')], [b.x, b.y], 'wire end');
});

s.check('a pen wire is labelled with its ref', () => {
  const svg = R.renderBoard(project(), {});
  eq(attr(els(svg, 'wire')[0], 'data-ref'), 'W1', 'wire data-ref');
  ok(els(svg, 'wire-label').some((e) => attr(e, 'data-ref') === 'W1'), 'W1 label drawn');
});

s.check('a placement is drawn and addressable by ref', () => {
  const svg = R.renderBoard(project(), {});
  ok(els(svg, 'part').some((e) => attr(e, 'data-ref') === 'R1'), 'R1 is drawn');
});

s.check('every interactive element carries data-kind', () => {
  const svg = R.renderBoard(project(), {});
  for (const kind of ['copper', 'hole', 'wire', 'part']) {
    ok(els(svg, kind).length > 0, `${kind} elements exist`);
  }
});

s.check('THE UNDERSIDE VIEW IS MIRRORED IN X', () => {
  const p = project();
  const w = geom.boardSizeMm(p.board).w;
  const under = R.renderBoard(p, { view: 'underside' });
  const holes = els(under, 'hole');
  const h00 = holes.find((h) => attr(h, 'data-hole') === '0,0');
  // Hole 0,0 is at the left in the top view and must appear at the right here.
  eq(num(h00, 'cx'), w - geom.holeToMm(0, 0).x, 'hole 0,0 mirrored');
});

s.check('the underside view drops component bodies — you solder from there', () => {
  eq(els(R.renderBoard(project(), { view: 'underside' }), 'part-body').length, 0,
    'no part bodies underside');
});

s.check('rendering does not mutate the project', () => {
  const p = project();
  const before = JSON.stringify(p);
  R.renderBoard(p, { view: 'underside', theme: 'dark' });
  eq(JSON.stringify(p), before, 'project unchanged');
});

s.check('DRC error holes are marked', () => {
  const p = board.makeProject({ cols: 10, rows: 6 });
  // Both legs on one uncut strip: shorted out.
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 3, at: { col: 1, row: 0 }, rot: 0 });
  const svg = R.renderBoard(p, { findings: R.findingsFor(p) });
  ok(els(svg, 'drc').length > 0, 'a DRC marker is drawn');
});

s.check('a clean layout draws no DRC markers', () => {
  const p = project();
  eq(els(R.renderBoard(p, { findings: R.findingsFor(p).filter((d) => d.severity === 'error') }),
    'drc').length, 0, 'no error markers');
});

s.check('highlighting a net marks its segments and nothing else', () => {
  const p = project();
  const { nets } = R.netsFor(p);
  const svg = R.renderBoard(p, { highlightNet: nets[0].id });
  const lit = els(svg, 'copper').filter((e) => attr(e, 'data-highlight') === 'true');
  eq(lit.length, nets[0].segments.length, 'exactly the net’s segments are lit');
});

s.check('the two themes render differently', () => {
  const p = project();
  ok(R.renderBoard(p, { theme: 'light' }) !== R.renderBoard(p, { theme: 'dark' }),
    'light and dark differ');
});

s.check('the wire run list is rendered in ref order', () => {
  const p = project();
  p.wires.push({ ref: 'W2', from: { col: 1, row: 1 }, to: { col: 2, row: 3 } });
  eq(R.runList(p).map((w) => w.ref), ['W1', 'W2'], 'run list order');
});

process.exit((await s.run()) ? 0 : 1);
