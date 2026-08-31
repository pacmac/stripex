// Every pad shown, pin 1 square.
// Governed by docs/specs/visible-pads.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const lib = await softImport('../../src/parts/library.js', here);
const rot = await softImport('../../src/model/rotate.js', here);

const s = suite('pads');

const attr = (el, name) => {
  const m = el.match(new RegExp(`(?:^|[ ])${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const pads = (svg) => [...String(svg).matchAll(/<[^>]*data-kind="pad"[^>]*>/g)].map((m) => m[0]);
const tagOf = (el) => (el.match(/^<([a-z]+)/) ?? [])[1];

function project(placements) {
  const p = boardm.makeProject({ cols: 30, rows: 20 });
  p.placements.push(...placements);
  return p;
}

const dip = { ref: 'U1', part: 'dip', span: 7, width: 3, at: { col: 6, row: 6 }, rot: 90 };
const res = { ref: 'R1', part: 'res-axial', span: 4, at: { col: 2, row: 2 }, rot: 0 };
const led = { ref: 'LED1', part: 'led', at: { col: 20, row: 2 }, rot: 0 };

s.check('ONE PAD PER PIN, FOR EVERY PART', () => {
  for (const pl of [dip, res, led]) {
    const want = rot.resolvePins([pl], lib.getPart).length;
    eq(pads(R.renderBoard(project([pl]), {})).length, want, `${pl.part}: ${want} pads`);
  }
});

s.check('PIN 1 IS A SQUARE', () => {
  // "Pin 1" means the part's FIRST pin, whatever it is called. An LED's pins are
  // named A and K, and its anode is still the square one.
  for (const pl of [dip, res, led]) {
    const list = pads(R.renderBoard(project([pl]), {}));
    const first = list.filter((el) => attr(el, 'data-first') === 'true');
    eq(first.length, 1, `${pl.part}: exactly one first pin`);
    eq(tagOf(first[0]), 'rect', `${pl.part}: it is a rect`);
    const wantName = rot.resolvePins([pl], lib.getPart)[0].pin;
    eq(attr(first[0], 'data-pin'), wantName, `${pl.part}: and it is pin ${wantName}`);
  }
});

s.check('EVERY OTHER PIN IS ROUND', () => {
  const list = pads(R.renderBoard(project([dip]), {}));
  const others = list.filter((el) => attr(el, 'data-first') !== 'true');
  eq(others.length, 13, 'thirteen other pins');
  for (const el of others) {
    eq(tagOf(el), 'circle', `pin ${attr(el, 'data-pin')} is a circle`);
  }
});

s.check('a square pad and a round pad are the same size across', () => {
  const list = pads(R.renderBoard(project([dip]), {}));
  const square = list.find((el) => tagOf(el) === 'rect');
  const round = list.find((el) => tagOf(el) === 'circle');
  eq(Number(attr(square, 'width')), Number(attr(round, 'r')) * 2, 'same across the flats');
  eq(Number(attr(square, 'width')), Number(attr(square, 'height')), 'and it is square');
});

s.check('THE PAD IS BIG ENOUGH TO SEE, AT THE SILKSCREEN WEIGHT', () => {
  // The old pads were 0.12 mm in a mid grey — about a fifth the weight of the
  // silkscreen line beside them, which is why they read as absent.
  for (const el of pads(R.renderBoard(project([dip]), {}))) {
    const w = Number(attr(el, 'stroke-width'));
    ok(w >= 0.18, `stroke-width ${w} mm, want at least the silk weight`);
  }
});

s.check('a pad surrounds its hole rather than covering it', () => {
  const round = pads(R.renderBoard(project([dip]), {})).find((el) => tagOf(el) === 'circle');
  const r = Number(attr(round, 'r'));
  ok(r > 0.5, `pad radius ${r} mm is bigger than the 0.5 mm hole radius`);
  ok(r < 1.27, `pad radius ${r} mm stays inside the half-pitch, so pads cannot touch`);
});

s.check('every pad is still clickable and still names its pin', () => {
  for (const el of pads(R.renderBoard(project([dip]), {}))) {
    eq(attr(el, 'pointer-events'), 'all', 'pointer-events');
    ok(attr(el, 'data-pin'), 'data-pin present');
  }
});

s.check('NO PIN CARRIES TWO MARKERS', () => {
  // The DIL body used to draw pin 1 its own extra ring; that is now the pad's
  // job and two outlines on one pin would be a double for no reason.
  const list = pads(R.renderBoard(project([dip]), {}));
  const names = list.map((el) => attr(el, 'data-pin'));
  eq(new Set(names).size, names.length, 'each pin appears once');
});

s.check('a two-pin part still gets a square pin 1', () => {
  const list = pads(R.renderBoard(project([res]), {}));
  eq(list.filter((el) => tagOf(el) === 'rect').length, 1, 'exactly one square');
  eq(list.filter((el) => tagOf(el) === 'circle').length, 1, 'and one round');
});

s.check('the pads are drawn on the underside view too', () => {
  // That is the side you solder them from.
  eq(pads(R.renderBoard(project([dip]), { view: 'underside' })).length, 14, 'fourteen pads');
});

s.check('A DIL HAS NO NOTCH — THE SQUARE PAD SAYS WHICH END IS PIN 1', () => {
  // The notch was added when the DIL body drew its own pin-1 ring. That ring is
  // gone and pin 1 is the square pad on every part alike, so the notch became a
  // second way of saying the same thing, on one part only.
  const svg = R.renderBoard(project([dip]), {});
  // Everything the part draws, not "up to the first </g>": a body is wrapped in
  // the group carrying its silkscreen clearance mask, so the first close tag is
  // that wrapper's and the pads come after it.
  const chunk = svg.slice(svg.indexOf('data-ref="U1"'));
  const next = chunk.indexOf('<g data-kind="part"', 1);
  const group = next > 0 ? chunk.slice(0, next) : chunk;
  ok(!group.includes('<path'), 'no path element in the DIL group');
  ok(group.includes('data-kind="part-body"'), 'the body is still drawn');
  const first = pads(group).filter((el) => attr(el, 'data-first') === 'true');
  eq(first.length, 1, 'and pin 1 is still identifiable');
  eq(tagOf(first[0]), 'rect', 'by its square pad');
});

s.check('hiding the components layer takes its pads with it', () => {
  eq(pads(R.renderBoard(project([dip]), { layers: { components: false } })).length, 0,
    'no pads for a hidden part');
});

process.exit((await s.run()) ? 0 : 1);
