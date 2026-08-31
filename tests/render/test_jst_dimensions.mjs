// A JST XH is drawn the size JST says it is.
// Governed by docs/specs/jst-real-dimensions.md
//
// Peter, 2026-08-31: "the footprint for JST XH is wrong."
//
// THE NUMBERS HERE COME FROM THE DATASHEET, NOT FROM THE CODE. The JST XH
// drawing dimensions the housing as A = 2.5(n-1) for the pin span and B = A +
// 4.9 for the length, and the KiCad footprint library's fab outlines agree:
// 9.9 mm long for a 3-way, 5.75 mm deep vertical, 11.5 mm deep horizontal with
// 9.2 mm of it over the board. A check that read the constants out of svg.js
// would pass whatever they were set to.
//
// It was wrong by a CONSTANT, not a proportion — one hole short at every size —
// which is why the 8-way looked nearly right and the 2-way looked badly wrong.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const D = await softImport('../../src/parts/devices.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const G = await softImport('../../src/model/geometry.js', here);

const s = suite('jst-dimensions');

const PITCH = G.PITCH_MM;

// From the JST drawing, cross-checked against KiCad's fab outlines.
const END_MM = 2.45;          // housing past each end pin — (B - A) / 2
const VERTICAL_DEEP = 5.75;   // across the pin row
const RIGHT_DEEP = 11.5;
const RIGHT_OVER_BOARD = 9.2; // of that depth, the part lying over the board
const NEAR = (a, b, tol, what) => ok(Math.abs(a - b) <= tol,
  `${what}: ${a.toFixed(2)} vs ${b.toFixed(2)} (tolerance ${tol})`);

// The body rect of the only placement on a board.
function bodyOf(deviceId) {
  const p = boardm.makeProject({ cols: 30, rows: 20 });
  const pl = D.placementFor(deviceId, { col: 2, row: 4 }, 0, 'J1');
  ok(pl, `${deviceId} is in the catalogue`);
  p.placements.push(pl);
  const svg = R.renderBoard(p, {});
  const m = /<rect data-kind="part-body"([^>]*)\/>/.exec(svg);
  ok(m, `${deviceId} draws a body: ${svg.slice(0, 80)}`);
  const num = (name) => Number(new RegExp(`\\b${name}="(-?[0-9.]+)"`).exec(m[1])?.[1]);
  return { x: num('x'), y: num('y'), w: num('width'), h: num('height') };
}

// ------------------------------------------------- length scales per way

for (const ways of [2, 3, 5, 8]) {
  s.check(`A ${ways}-WAY BODY IS THE PIN SPAN PLUS 4.9 mm`, () => {
    const span = (ways - 1) * PITCH;      // the pins really are on the board's pitch
    for (const angle of ['straight', 'right']) {
      const b = bodyOf(`jst-xh-${ways}-${angle}`);
      NEAR(b.w, span + 2 * END_MM, 0.3, `${ways}-way ${angle} length`);
    }
  });
}

s.check('SO AN n-WAY IS ABOUT n+1 HOLES LONG, NEVER n', () => {
  // The whole of the defect in one line: it drew exactly n holes.
  for (const ways of [2, 3, 5, 8]) {
    const holes = bodyOf(`jst-xh-${ways}-straight`).w / PITCH;
    ok(holes > ways + 0.6,
      `${ways}-way is ${holes.toFixed(2)} holes long, which must be nearer ${ways + 1} than ${ways}`);
    ok(holes < ways + 1.3, `${ways}-way is not overdrawn: ${holes.toFixed(2)} holes`);
  }
});

s.check('and the housing clears each end pin by about a hole', () => {
  const b = bodyOf('jst-xh-3-straight');
  const span = 2 * PITCH;
  NEAR((b.w - span) / 2, END_MM, 0.2, 'overhang past each end pin');
});

// ------------------------------------------------- depth does NOT scale

s.check('DEPTH IS THE SAME AT EVERY WAY COUNT', () => {
  // A 2-way and an 8-way XH are equally deep. Only the length grows.
  const straight = [2, 3, 5, 8].map((w) => bodyOf(`jst-xh-${w}-straight`).h);
  const right = [2, 3, 5, 8].map((w) => bodyOf(`jst-xh-${w}-right`).h);
  ok(Math.max(...straight) - Math.min(...straight) < 0.01, `straight: ${straight.join(' ')}`);
  ok(Math.max(...right) - Math.min(...right) < 0.01, `right angle: ${right.join(' ')}`);
});

s.check('and it is the depth on the drawing', () => {
  NEAR(bodyOf('jst-xh-3-straight').h, VERTICAL_DEEP, 0.3, 'vertical depth');
  NEAR(bodyOf('jst-xh-3-right').h, RIGHT_DEEP, 0.3, 'right-angle depth');
});

// ------------------------------------------------- the one that matters

s.check('A RIGHT ANGLE LIES 9.2 mm OVER THE BOARD, PAST ITS PINS', () => {
  // The number a layout has to respect: about 3.6 strips of board that are
  // underneath the connector. Drawing 1.45 said they were free.
  const b = bodyOf('jst-xh-3-right');
  // The rect is drawn about the pin row at y = 0 inside a rotated group.
  const overBoard = b.y + b.h;
  NEAR(overBoard, RIGHT_OVER_BOARD, 0.3, 'body reaching over the board from the pin row');
  ok(overBoard / PITCH > 3, `which is ${(overBoard / PITCH).toFixed(1)} strips`);
});

s.check('and a vertical body is NOT centred on the pin row', () => {
  // The real one is asymmetric — 2.35 behind, 3.4 in front. Centring it was an
  // invention.
  const b = bodyOf('jst-xh-3-straight');
  ok(Math.abs(Math.abs(b.y) - b.h / 2) > 0.3,
    `y=${b.y.toFixed(2)} against half-depth ${(b.h / 2).toFixed(2)} — it must not be centred`);
});

s.check('and it survives rotation, still drawn in a rotated group', () => {
  const p = boardm.makeProject({ cols: 30, rows: 20 });
  p.placements.push(D.placementFor('jst-xh-4-right', { col: 4, row: 4 }, 90, 'J1'));
  const svg = R.renderBoard(p, {});
  ok(/<g transform="translate\([^"]*\) rotate\(/.test(svg), 'a rotated group is used');
  const m = /<rect data-kind="part-body"([^>]*)\/>/.exec(svg);
  const w = Number(/\bwidth="([0-9.]+)"/.exec(m[1])[1]);
  NEAR(w, 3 * PITCH + 2 * END_MM, 0.3, 'a rotated 4-way keeps its length');
});

process.exit(await s.run() ? 0 : 1);
