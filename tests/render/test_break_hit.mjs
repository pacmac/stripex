// A cut underneath a component must still be clickable.
// Governed by docs/specs/break-hit-targets.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const brk = await softImport('../../src/model/breaks.js', here);

const s = suite('break-hit');

const els = (svg, kind) => [...String(svg).matchAll(
  new RegExp(`<[^>]*data-kind="${kind}"[^>]*>`, 'g'),
)].map((m) => m[0]);
const attr = (el, name) => {
  const m = el.match(new RegExp(`(?:^|[ ])${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const tagOf = (el) => (el.match(/^<([a-z]+)/) ?? [])[1];

// A DIL straddling the strips: every cut it makes is under its own body, which
// is exactly the set that was unreachable.
function withDil() {
  const p = boardm.makeProject({ cols: 25, rows: 20 });
  p.placements.push({ ref: 'U1', part: 'dip', span: 7, width: 3,
    at: { col: 8, row: 4 }, rot: 90 });
  return p;
}

function withBothCuts() {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.breaks.push({ row: 2, x: 5, at: 'gap' }, { row: 4, x: 7, at: 'hole' });
  return p;
}

s.check('EVERY DRAWN BREAK HAS A HIT TARGET', () => {
  const svg = R.renderBoard(withDil(), {});
  const marks = els(svg, 'break');
  const hits = els(svg, 'break-hit');
  ok(marks.length > 0, `the DIL draws ${marks.length} cuts`);
  eq(hits.length, marks.length, 'one target each');
});

s.check('the targets name the same cuts as the markers', () => {
  const svg = R.renderBoard(withDil(), {});
  const of = (kind) => els(svg, kind).map((e) => attr(e, 'data-break')).sort();
  eq(of('break-hit'), of('break'), 'same set');
});

s.check('EVERY TARGET IS PAINTED AFTER EVERY PART, SO IT IS ON TOP', () => {
  const svg = R.renderBoard(withDil(), {});
  const lastPart = svg.lastIndexOf('data-kind="part"');
  const firstHit = svg.indexOf('data-kind="break-hit"');
  ok(lastPart >= 0 && firstHit >= 0, 'both present');
  ok(firstHit > lastPart, 'the first target comes after the last part');
});

s.check('a target is invisible — the drawing is unchanged', () => {
  for (const el of els(R.renderBoard(withDil(), {}), 'break-hit')) {
    eq(attr(el, 'fill'), 'none', 'no fill');
    ok(!attr(el, 'stroke') || attr(el, 'stroke') === 'none', 'no stroke');
  }
});

s.check('...but it is clickable, which is its whole purpose', () => {
  for (const el of els(R.renderBoard(withDil(), {}), 'break-hit')) {
    eq(attr(el, 'pointer-events'), 'all', 'pointer-events');
  }
});

s.check('a spot-face gets a circle and a knife cut gets a rect', () => {
  const svg = R.renderBoard(withBothCuts(), {});
  const hits = els(svg, 'break-hit');
  eq(hits.length, 2, 'two targets');
  const byAt = Object.fromEntries(hits.map((e) => [attr(e, 'data-at'), tagOf(e)]));
  eq(byAt.gap, 'rect', 'knife cut');
  eq(byAt.hole, 'circle', 'spot-face');
});

s.check('HIDING THE BREAKS LAYER REMOVES THE TARGETS TOO', () => {
  // A hidden layer that still swallows clicks is the exact fault the layer
  // feature exists to avoid.
  const svg = R.renderBoard(withDil(), { layers: { breaks: false } });
  eq(els(svg, 'break').length, 0, 'no markers');
  eq(els(svg, 'break-hit').length, 0, 'and no targets');
});

s.check('a board with no cuts emits no targets', () => {
  const p = boardm.makeProject({ cols: 12, rows: 6 });
  eq(els(R.renderBoard(p, {}), 'break-hit').length, 0, 'none');
});

s.check('the cuts really are under the part — that is why this was needed', () => {
  // The DIL's own cuts sit inside its body's footprint, so the body was the
  // topmost element over all of them.
  const p = withDil();
  const cuts = brk.effectiveBreaks(p);
  ok(cuts.length > 0, 'it has cuts');
  const box = R.footprintBox(p.placements[0]);
  const geom = { pitch: 2.54 };
  for (const b of cuts) {
    const x = b.at === 'hole' ? (b.x + 0.5) * geom.pitch : (b.x + 1) * geom.pitch;
    const y = (b.row + 0.5) * geom.pitch;
    ok(x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h,
      `cut ${b.row},${b.x} lies inside the body`);
  }
});

s.check('A TARGET IS NO BIGGER THAN A PAD, OR IT SWALLOWS THE PART', () => {
  // Measured with a generous target: 44% of a DIL's body selected a cut rather
  // than the chip, because seven of them run down the middle of a 12.7 mm
  // package. A pad-sized target is comfortably clickable — the move tool clicks
  // pads all day — and leaves the body the obvious thing to hit.
  const svg = R.renderBoard(withBothCuts(), {});
  for (const el of els(svg, 'break-hit')) {
    const across = tagOf(el) === 'circle'
      ? Number(attr(el, 'r')) * 2
      : Number(attr(el, 'width'));
    // 0.01 mm of slack: the renderer rounds coordinates to three decimals for
    // legible output, so 0.8636 is emitted as 0.864.
    ok(across <= R.PAD_R_MM * 2 + 0.01, `${attr(el, 'data-at')} target ${across} mm across`);
    ok(across > 0.6, `${attr(el, 'data-at')} target is still clickable at ${across} mm`);
  }
});

s.check('user cuts out in the open get targets as well', () => {
  eq(els(R.renderBoard(withBothCuts(), {}), 'break-hit').length, 2, 'both');
});

process.exit((await s.run()) ? 0 : 1);
