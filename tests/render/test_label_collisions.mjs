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

process.exit((await s.run()) ? 0 : 1);
