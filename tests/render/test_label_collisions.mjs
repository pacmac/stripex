// Part labels do not print over each other.
// Governed by docs/specs/labels-dont-collide.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const geom = await softImport('../../src/model/geometry.js', here);

const s = suite('label-collisions');
const P = geom.PITCH_MM;

// Every part label, with the box its text occupies, estimated the way the
// renderer is told to: 0.55 of the font size per character.
const labels = (svg) => [...String(svg).matchAll(/<text data-kind="part-label"[^>]*>([^<]*)<\/text>/g)].map((m) => {
  const g = (k) => m[0].match(new RegExp(` ${k}="([^"]*)"`))?.[1];
  const x = Number(g('x'));
  const y = Number(g('y'));
  const fs = Number(g('font-size'));
  const w = m[1].length * fs * 0.55;
  const anchor = g('text-anchor') ?? 'start';
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return { text: m[1], x, y, box: { x0, x1: x0 + w, y0: y - fs * 0.8, y1: y + fs * 0.2 } };
});
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

s.check('ON A DENSE BOARD NO TWO PART LABELS OVERLAP', () => {
  const p = boardm.makeProject({ cols: 16, rows: 14 });
  p.placements = [3, 4, 5, 6].map((col, i) => ({
    ref: `R${i + 1}`, part: 'res-axial', span: 4, at: { col, row: 5 }, rot: 90, value: '330R',
  }));
  const got = labels(R.renderBoard(p));
  eq(got.length, 4, 'four labels');
  const hits = [];
  for (let i = 0; i < got.length; i += 1) {
    for (let j = i + 1; j < got.length; j += 1) {
      if (overlap(got[i].box, got[j].box)) hits.push(`${got[i].text} / ${got[j].text}`);
    }
  }
  eq(hits, [], 'no overlapping labels');
});

s.check('A LONE PART\'S LABEL IS WHERE IT ALWAYS WAS', () => {
  const p = boardm.makeProject({ cols: 16, rows: 14 });
  p.placements = [{ ref: 'R1', part: 'res-axial', span: 4, at: { col: 5, row: 5 }, rot: 90, value: '10k' }];
  const [l] = labels(R.renderBoard(p));
  ok(Math.abs(l.x - (5 + 0.5) * P) < 0.01, `x above the first pin: ${l.x}`);
  ok(Math.abs(l.y - ((5 + 0.5) * P - P * 0.5)) < 0.01, `y half a pitch above it: ${l.y}`);
});

// ------------------------------------------------------ labels-clear-of-pads.md

// Every pad the renderer draws, as a box: centre plus the radius it is drawn at.
const pads = (svg) => [...String(svg).matchAll(/<(circle|rect) data-kind="pad"[^>]*>/g)].map((m) => {
  const g = (k) => m[0].match(new RegExp(` ${k}="([^"]*)"`))?.[1];
  return m[1] === 'circle'
    ? { x: Number(g('cx')), y: Number(g('cy')), r: Number(g('r')) }
    : { x: Number(g('x')) + Number(g('width')) / 2, y: Number(g('y')) + Number(g('height')) / 2, r: Number(g('width')) / 2 };
});
const onPad = (b, p) => b.x0 < p.x + p.r && p.x - p.r < b.x1 && b.y0 < p.y + p.r && p.y - p.r < b.y1;

s.check('NO LABEL PRINTS OVER ANOTHER PART\'S PAD', () => {
  // The shape it fails in: wire links threaded between a 14-pin socket's rows,
  // as on the Yagi board, where L5, L6 and J2 each landed on a neighbour's pad.
  // The shape it fails in, taken from the Yagi board: a link one column over
  // and one row down from a connector, so the link's ref — which goes half a
  // pitch above its first pin — lands on the connector's pad. There, L5 sat on
  // J1's, L6 on U1's and J2 on a link's.
  const p = boardm.makeProject({ cols: 12, rows: 19 });
  p.placements = [
    { ref: 'L4', part: 'wire-link', span: 5, at: { col: 2, row: 0 }, rot: 90 },
    { ref: 'L5', part: 'wire-link', span: 4, at: { col: 2, row: 6 }, rot: 90 },
    { ref: 'L1', part: 'wire-link', span: 4, at: { col: 9, row: 0 }, rot: 90 },
    { ref: 'L6', part: 'wire-link', span: 5, at: { col: 9, row: 5 }, rot: 90 },
    { ref: 'U1', part: 'dip', span: 7, width: 6, at: { col: 4, row: 3 }, rot: 90 },
  ];
  const svg = R.renderBoard(p);
  const all = pads(svg);
  const got = labels(svg);
  ok(all.length > 10 && got.length === 5, `${got.length} labels over ${all.length} pads`);
  // Its OWN pads are allowed: a link's ref sits on its own line by design.
  const mine = (l) => (l.text.split(' ')[0]);
  const ownPads = Object.fromEntries(got.map((l) => [mine(l), null]));
  const hits = [];
  for (const l of got) {
    // A label may cross the bare board; only a drawn pad that is not its own counts.
    const own = svg.match(new RegExp(`<g data-kind="part" data-ref="${mine(l)}"[\\s\\S]*?</g>`))?.[0] ?? '';
    const ownSet = new Set(pads(own).map((q) => `${q.x},${q.y}`));
    for (const q of all) {
      if (ownSet.has(`${q.x},${q.y}`)) continue;
      if (onPad(l.box, q)) hits.push(`${l.text} on a pad at ${q.x.toFixed(1)},${q.y.toFixed(1)}`);
    }
  }
  void ownPads;
  eq(hits, [], 'no label sits on another part\'s pad');
});

process.exit((await s.run()) ? 0 : 1);
