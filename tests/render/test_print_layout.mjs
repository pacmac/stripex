// The arithmetic of a printed sheet, without a browser.
// Governed by docs/specs/print-sheet.md
//
// Peter, 2026-09-17: "need a print button, prefereably with options to print in
// colours and black and white, and to be able to print top and bottom on a
// single A4 sheet, either to scale or fill to contents."

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const P = await softImport('../../src/render/print.js', here);
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('print-layout');

const drawingOf = (cols, rows) => P.viewBoxSize(R.renderBoard(boardm.makeProject({ cols, rows })));

s.check('A 30 x 14 BOARD, BOTH SIDES, ACTUAL SIZE, FITS ON ONE A4', () => {
  ok(typeof P.printLayout === 'function', 'printLayout exists');
  if (typeof P.printLayout !== 'function') return;
  const d = drawingOf(30, 14);
  const lay = P.printLayout({ drawing: d, sides: 'both', size: 'actual' });
  eq(lay.views.map((v) => v.view), ['top', 'underside'], 'two views, top then underside');
  eq(lay.fits, true, `fits: ${lay.message}`);
  eq(lay.scale, 1, 'at scale 1');
  ok(Math.abs(lay.views[0].widthMm - d.w) < 1e-6, `printed width is the drawing width: ${lay.views[0].widthMm} vs ${d.w}`);
  ok(/fit/i.test(lay.message) && /A4/.test(lay.message), `says it fits on A4: "${lay.message}"`);
});

s.check('A BOARD TOO TALL FOR TWO VIEWS AT ACTUAL SIZE SAYS SO, AND WHAT TO DO', () => {
  const lay = P.printLayout({ drawing: drawingOf(30, 60), sides: 'both', size: 'actual' });
  eq(lay.fits, false, 'does not fit');
  ok(/Fill the page/.test(lay.message), `points at Fill the page: "${lay.message}"`);
  const one = P.printLayout({ drawing: drawingOf(30, 60), sides: 'top', size: 'actual' });
  eq(one.fits, true, `one view of the same board does: ${one.message}`);
});

s.check('FILL GIVES BOTH VIEWS ONE SCALE, THE LARGEST THAT FITS', () => {
  const d = drawingOf(30, 60);
  const lay = P.printLayout({ drawing: d, sides: 'both', size: 'fill' });
  eq(lay.fits, true, 'fill always fits');
  eq(lay.views[0].widthMm, lay.views[1].widthMm, 'top and underside printed the same size');
  const { w, h } = P.printableMm({ views: 2 });
  const usedW = lay.views[0].widthMm;
  const usedH = lay.views.reduce((a, v) => a + v.heightMm, 0);
  ok(usedW <= w + 1e-6 && usedH <= h + 1e-6, `inside the printable area: ${usedW} x ${usedH} in ${w} x ${h}`);
  ok(Math.abs(usedW - w) < 1e-6 || Math.abs(usedH - h) < 1e-6, 'and touching one of its limits, so it is the largest');
  // A small board is scaled UP to fill, not left at actual size.
  eq(P.printLayout({ drawing: drawingOf(10, 6), sides: 'top', size: 'fill' }).scale > 1, true, 'a small board is enlarged');
});

s.check('BLACK AND WHITE IS A THEME: WHITE BOARD, BLACK INK', () => {
  ok(R.THEMES.mono, 'a mono theme exists');
  if (!R.THEMES.mono) return;
  eq(R.THEMES.mono.substrate.toLowerCase(), '#ffffff', 'the board is white');
  eq(R.THEMES.mono.ink.toLowerCase(), '#000000', 'the ink is black');
  const svg = R.renderBoard(boardm.makeProject({ cols: 6, rows: 4 }), { theme: 'mono' });
  ok(/data-kind="substrate"[^>]*fill="#ffffff"/i.test(svg), 'and the renderer uses it');
});

// ---------------------------------------------------------- print-view-2.md

s.check('6 mm MARGINS: THE PRINTABLE AREA IS 198 mm WIDE', () => {
  eq(P.PRINT_MARGIN_MM, 6, 'a 6 mm margin');
  eq(P.printableMm({ views: 1 }).w, 198, '210 - 12');
});

s.check('ONE PAGE FITS THE VIEWS AND THE TABLES ON ONE SHEET; WITH NO TABLES IT IS FILL', () => {
  ok(typeof P.tablesHeightMm === 'function', 'tablesHeightMm exists');
  if (typeof P.tablesHeightMm !== 'function') return;
  eq(P.tablesHeightMm([]), 0, 'no tables take no height');
  const tables = P.tablesHeightMm([12]);                  // a 12-row BOM
  ok(tables > 0, `a 12-row table has a height: ${tables} mm`);
  const d = drawingOf(12, 19);
  const one = P.printLayout({ drawing: d, sides: 'both', size: 'onepage', tablesMm: tables });
  const fill = P.printLayout({ drawing: d, sides: 'both', size: 'fill' });
  const area = P.printableMm({ views: 2 });
  const used = one.views.reduce((a, v) => a + v.heightMm, 0) + tables;
  ok(used <= area.h + 1e-6, `views ${used - tables} + tables ${tables} fit in ${area.h}`);
  ok(one.scale < fill.scale, `and it is smaller than fill: ${one.scale} < ${fill.scale}`);
  ok(/one A4 sheet/.test(one.message), `says so: "${one.message}"`);
  eq(P.printLayout({ drawing: d, sides: 'both', size: 'onepage', tablesMm: 0 }).scale, fill.scale,
    'with no tables, One page is Fill');
});

process.exit((await s.run()) ? 0 : 1);
