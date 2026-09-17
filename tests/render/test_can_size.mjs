// A can is the size the library says, however far apart its leads are.
// Governed by docs/specs/can-body-size.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const geom = await softImport('../../src/model/geometry.js', here);

const s = suite('can-size');
const P = geom.PITCH_MM;

const radiusOf = (placement) => {
  const project = { ...boardm.makeProject({ cols: 30, rows: 10 }), placements: [placement] };
  const svg = R.renderBoard(project);
  const m = svg.match(/<circle data-kind="part-body"[^>]* r="([^"]*)"/);
  return { r: m ? Number(m[1]) : null, extent: R.drawingExtentMm(project) };
};
const cap = (span) => ({ ref: 'C1', part: 'cap-electro', span, at: { col: 2, row: 4 }, rot: 0 });

s.check('AN ELECTROLYTIC IS 1.2 HOLES ACROSS THE RADIUS AT 2 HOLES OR 13', () => {
  const near = radiusOf(cap(2)).r;
  const far = radiusOf(cap(13)).r;
  ok(Math.abs(near - 1.2 * P) < 0.01, `at a 2-hole span: ${near} mm, declared ${1.2 * P}`);
  ok(Math.abs(far - 1.2 * P) < 0.01, `at a 13-hole span: ${far} mm, not ${(13 + 1) * P / 2}`);
});

s.check('AN LED IS 0.9 HOLES', () => {
  const { r } = radiusOf({ ref: 'D1', part: 'led', at: { col: 2, row: 4 }, rot: 0 });
  ok(Math.abs(r - 0.9 * P) < 0.01, `LED radius ${r} mm, declared ${0.9 * P}`);
});

s.check('THE EXTENT FOLLOWS THE DRAWING, NOT A 33 mm DISC', () => {
  const { extent } = radiusOf(cap(13));
  // Leads from column 2 to 15: the drawing needs no more height than the board.
  ok(extent.h <= 10 * P + 0.01, `extent height ${extent.h.toFixed(1)} mm on a ${(10 * P).toFixed(1)} mm board`);
  ok(extent.y >= -0.01, `and does not reach above the board: y ${extent.y.toFixed(2)}`);
});

process.exit((await s.run()) ? 0 : 1);
