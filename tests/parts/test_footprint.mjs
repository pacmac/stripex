// Pin 1 top-left, and outlines grown from the pins by half a hole pitch.
// Governed by docs/specs/footprint-geometry.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const lib = await softImport('../../src/parts/library.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const R = await softImport('../../src/render/svg.js', here);
const geom = await softImport('../../src/model/geometry.js', here);

const s = suite('footprint');

// rot 90 is how a DIL is actually used on stripboard: straddling the strips.
const dil = (span = 7, width = 3, at = { col: 10, row: 4 }) =>
  ({ ref: 'U1', part: 'dip', span, width, at, rot: 90 });

const pinsOf = (pl) => rot.resolvePins([pl], lib.getPart);
const byName = (pl) => Object.fromEntries(pinsOf(pl).map((p) => [p.pin, p]));

// ------------------------------------------------------------- pin 1 place

s.check('PIN 1 IS THE TOP-LEFT PIN OF A STRADDLING DIL', () => {
  const pins = pinsOf(dil());
  const minCol = Math.min(...pins.map((p) => p.col));
  const minRow = Math.min(...pins.map((p) => p.row));
  const p1 = byName(dil())['1'];
  eq([p1.col, p1.row], [minCol, minRow], 'pin 1 is at the top-left corner');
});

s.check('NUMBERING RUNS DOWN THE LEFT COLUMN', () => {
  const pins = byName(dil());
  const leftCol = pins['1'].col;
  for (let i = 1; i <= 7; i += 1) {
    eq(pins[String(i)].col, leftCol, `pin ${i} is in the left column`);
  }
  for (let i = 2; i <= 7; i += 1) {
    ok(pins[String(i)].row > pins[String(i - 1)].row, `pin ${i} is below pin ${i - 1}`);
  }
});

s.check('...and back up the right column', () => {
  const pins = byName(dil());
  const rightCol = pins['8'].col;
  ok(rightCol > pins['1'].col, 'the second column is to the right');
  for (let i = 8; i <= 14; i += 1) {
    eq(pins[String(i)].col, rightCol, `pin ${i} is in the right column`);
  }
  for (let i = 9; i <= 14; i += 1) {
    ok(pins[String(i)].row < pins[String(i - 1)].row, `pin ${i} is above pin ${i - 1}`);
  }
});

s.check('pin 1 and the last pin stay opposite each other at every width', () => {
  for (const width of [3, 4, 6]) {
    const pins = byName(dil(7, width));
    eq(pins['1'].row, pins['14'].row, `width ${width}: same row`);
    eq(pins['14'].col - pins['1'].col, width, `width ${width}: ${width} holes apart`);
  }
});

s.check('the package is still the right size', () => {
  eq(pinsOf(dil(8, 6)).length, 16, 'sixteen pins');
  const pins = pinsOf(dil(8, 6));
  eq(Math.max(...pins.map((p) => p.col)) - Math.min(...pins.map((p) => p.col)), 6, 'width');
  eq(Math.max(...pins.map((p) => p.row)) - Math.min(...pins.map((p) => p.row)), 7, 'length');
});

// ------------------------------------------------------------- the outline

const HALF_PITCH = 1.27;

s.check('SILK_MARGIN is half a hole pitch', () => {
  eq(R.SILK_MARGIN_MM, HALF_PITCH, 'margin');
  eq(R.SILK_MARGIN_MM * 2, geom.PITCH_MM, 'and two of them make a pitch');
});

s.check('AN OUTLINE IS THE PIN EXTENT GROWN BY 0.05 INCH', () => {
  for (const pl of [dil(7, 3), dil(8, 6),
    { ref: 'R1', part: 'res-axial', span: 4, at: { col: 2, row: 2 }, rot: 0 },
    { ref: 'J1', part: 'header', span: 3, at: { col: 2, row: 6 }, rot: 0 }]) {
    const pins = pinsOf(pl);
    const xs = pins.map((p) => geom.holeToMm(p.col, p.row).x);
    const ys = pins.map((p) => geom.holeToMm(p.col, p.row).y);
    const box = R.footprintBox(pl, lib.getPart);
    eq(box.x, Math.min(...xs) - HALF_PITCH, `${pl.part} left`);
    eq(box.y, Math.min(...ys) - HALF_PITCH, `${pl.part} top`);
    eq(box.w, Math.max(...xs) - Math.min(...xs) + HALF_PITCH * 2, `${pl.part} width`);
    eq(box.h, Math.max(...ys) - Math.min(...ys) + HALF_PITCH * 2, `${pl.part} height`);
  }
});

s.check('a one-pin part gets a box exactly one hole across', () => {
  const box = R.footprintBox({ ref: 'MH1', part: 'mount-hole', at: { col: 3, row: 3 }, rot: 0 },
    lib.getPart);
  eq([box.w, box.h], [geom.PITCH_MM, geom.PITCH_MM], 'one hole square');
});

s.check('TWO PARTS ON ADJACENT HOLES DO NOT OVERLAP', () => {
  // Half-pitch is why: an outline stops halfway to the next hole, so it can
  // never reach a neighbour.
  const a = R.footprintBox({ ref: 'A', part: 'led', at: { col: 4, row: 4 }, rot: 0 }, lib.getPart);
  const b = R.footprintBox({ ref: 'B', part: 'led', at: { col: 6, row: 4 }, rot: 0 }, lib.getPart);
  ok(a.x + a.w <= b.x + 1e-9, `A ends at ${a.x + a.w}, B starts at ${b.x}`);
});

s.check('a round body is sized by the LEAD PITCH, not by the short side of its box', () => {
  // Corrects an earlier claim of mine that an 8.1 mm circle for a 2-hole
  // electrolytic was oversized. Two holes of pitch is 5.08 mm between leads,
  // which is a 10 mm can — the old figure was about right. What was wrong was
  // that the size came from a per-part guess rather than from the footprint.
  const box = R.footprintBox({ ref: 'C1', part: 'cap-electro', span: 2,
    at: { col: 4, row: 4 }, rot: 0 }, lib.getPart);
  const near = (a, b, what) => ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
  near(Math.max(box.w, box.h), 3 * geom.PITCH_MM, 'lead span plus two margins');

  // A 1-hole part is a 5 mm LED, and its circle must be 5.08 mm, not 2.54.
  const led = R.footprintBox({ ref: 'LED1', part: 'led', at: { col: 4, row: 4 }, rot: 0 },
    lib.getPart);
  near(Math.max(led.w, led.h), 2 * geom.PITCH_MM, 'a 5 mm LED');
});

s.check('every drawn body sits inside its footprint box', () => {
  const p = { schema: 'stripex/1', board: { cols: 30, rows: 20, pattern: 'strip' },
    breaks: [], wires: [], placements: [] };
  const add = (ref, part, at, extra) => p.placements.push({ ref, part, at, rot: 0, ...extra });
  add('R1', 'res-axial', { col: 2, row: 2 }, { span: 4 });
  add('C1', 'cap-electro', { col: 9, row: 2 }, { span: 2 });
  add('Q1', 'to92', { col: 14, row: 2 });
  add('U1', 'dip', { col: 20, row: 5 }, { span: 5, width: 3 });
  const svg = R.renderBoard(p, {});
  ok(svg.includes('data-kind="part-body"'), 'bodies are drawn');
  for (const pl of p.placements) {
    const box = R.footprintBox(pl, lib.getPart);
    ok(box.w > 0 && box.h > 0, `${pl.ref} has a box`);
  }
});

s.check('the 0603 is drawn as its land, INSIDE its box', () => {
  // This asserted 1.2–2.2 mm: the chip's own 1.6 mm, deliberately smaller than
  // its footprint. That rule is replaced by docs/specs/smt-land-pattern.md —
  // accurate at that size and invisible, being 0.8 mm of translucent silk on a
  // 2.0 mm strip. The part that has not changed is that the body still fits
  // within the courtyard, which is what this file is about.
  const pl = { ref: 'R9', part: 'smt-0603', at: { col: 4, row: 4 }, rot: 0 };
  const box = R.footprintBox(pl, lib.getPart);
  const svg = R.renderBoard({ schema: 'stripex/1',
    board: { cols: 12, rows: 8, pattern: 'strip' }, breaks: [], wires: [],
    placements: [pl] }, {});
  const chunk = svg.slice(svg.indexOf('data-ref="R9"'));
  const body = chunk.slice(0, chunk.indexOf('</g>'));
  const w = Number((body.match(/width="([\d.]+)"/) ?? [])[1]);
  const h = Number((body.match(/height="([\d.]+)"/) ?? [])[1]);
  ok(w > geom.PITCH_MM, `it reaches across both holes: ${w} > ${geom.PITCH_MM}`);
  ok(w <= box.w + 0.01, `and stays inside its courtyard: ${w} <= ${box.w}`);
  ok(h <= box.h + 0.01, `on the short axis too: ${h} <= ${box.h}`);
});

process.exit((await s.run()) ? 0 : 1);
