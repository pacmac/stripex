// The arithmetic of a printed sheet. See docs/specs/print-sheet.md.
//
// Peter, 2026-09-17: "to be able to print top and bottom on a single A4 sheet,
// either to scale or fill to contents."
//
// Pure, so node can check the numbers and the dialog and the sheet cannot
// disagree about them: the dialog's sentence and the sheet's sizes both come
// from printLayout.

import { PITCH_MM } from '../model/geometry.js';
import { columnLabel } from '../model/labels.js';
import { cutList, runList } from '../model/views.js';

// A HOLE NAMED THE WAY THE BOARD'S EDGES LABEL IT: row letter, column number.
// Zero-based in, so holeName(4, 2) is C5 — the hole you find by reading C down
// the side and 5 along the top.
export const holeName = (col, row) => `${columnLabel(row + 1)}${col + 1}`;

// Every cut to make, derived ones included, in those names. A knife cut sits
// between two columns — "C 4|5" — and a spot-face is at a hole — "C5".
export function cutRows(project) {
  return cutList(project).map((b) => (b.at === 'hole'
    ? { where: holeName(b.x, b.row), kind: 'spot-face' }
    : { where: `${columnLabel(b.row + 1)} ${b.x + 1}|${b.x + 2}`, kind: 'knife' }));
}

// Every pen wire, hole to hole, in the same names.
export function wireRows(project) {
  return runList(project).map((w) => ({
    ref: w.ref, from: holeName(w.from.col, w.from.row), to: holeName(w.to.col, w.to.row),
  }));
}

export const A4_MM = { w: 210, h: 297 };
// Peter: "a 6mm margin is needed all around." The same number is the @page
// margin in the stylesheet and the preview page's padding.
export const PRINT_MARGIN_MM = 6;

// A TABLE'S HEIGHT, COMPUTED NOT GUESSED. The stylesheet gives a table's title,
// header row and body rows these exact heights, so One page can reserve room for
// the tables before it scales the board. Change one, change the other.
export const TABLE_GAP_MM = 4;
export const TABLE_TITLE_MM = 7;
export const TABLE_HEAD_MM = 6;
export const TABLE_ROW_MM = 5.5;
// Room left over on a One page sheet for the browser's pixel rounding.
export const ONE_PAGE_SLACK_MM = 3;
// Below this a printed hole is too small to build from, and One page says so.
export const MIN_READABLE_PITCH_MM = 1.5;

// The height the chosen tables will take, given each table's body row count.
// A table with no rows still prints its title and a "None" line.
export const tablesHeightMm = (rowCounts = []) => rowCounts
  .reduce((sum, rows) => sum + TABLE_GAP_MM + TABLE_TITLE_MM
    + (rows ? TABLE_HEAD_MM + rows * TABLE_ROW_MM : TABLE_ROW_MM), 0);
// The name, date and scale line at the top of the sheet.
export const HEADER_MM = 10;
// "Top — the component side" above each view.
export const CAPTION_MM = 6;
// Between the two views when both are on the sheet.
export const GAP_MM = 6;

// The space left for the DRAWINGS themselves, once margins, the header, a
// caption per view and the gap between them are taken out.
export function printableMm({ views = 1 } = {}) {
  return {
    w: A4_MM.w - PRINT_MARGIN_MM * 2,
    h: A4_MM.h - PRINT_MARGIN_MM * 2 - HEADER_MM - CAPTION_MM * views - GAP_MM * (views - 1),
  };
}

// The drawing's size in millimetres, read from the viewBox renderBoard already
// writes in millimetres — so "actual size" is the drawing's own numbers.
export function viewBoxSize(svg) {
  const m = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(String(svg));
  return m ? { w: Number(m[3]), h: Number(m[4]) } : { w: 0, h: 0 };
}

const mm = (v) => (Math.round(v * 10) / 10).toString();

// { drawing: {w, h} mm, sides: 'top' | 'underside' | 'both', size: 'actual' | 'fill' }
// -> { views: [{ view, widthMm, heightMm }], scale, fits, need, message }
export function printLayout({ drawing, sides = 'both', size = 'actual', tablesMm = 0 } = {}) {
  const names = sides === 'both' ? ['top', 'underside'] : [sides === 'underside' ? 'underside' : 'top'];
  const n = names.length;
  const area = printableMm({ views: n });
  const need = { w: drawing.w, h: drawing.h * n };
  const who = n === 2 ? 'both views need' : 'it needs';

  let scale = 1;
  let fits;
  let message;
  let readable = true;
  if (size === 'onepage') {
    // ONE PAGE: the views scaled by one factor, the largest at which they AND
    // the chosen tables fit on one A4 sheet. Peter: "an option to fit on 1 page
    // would be good as now it flows onto 2 pages, with ONLY the BOM selected".
    //
    // Less ONE_PAGE_SLACK_MM when there are tables: every table row is rounded
    // to device pixels, and those add up — measured once at 1.3 mm over, on two
    // pages. With no tables there is nothing to accumulate: Fill came out at
    // 284.99 of 285 mm on three board shapes, one page each, so One page is Fill.
    const room = area.h - tablesMm - (tablesMm > 0 ? ONE_PAGE_SLACK_MM : 0);
    if (room <= 0) {
      scale = Math.min(area.w / need.w, area.h / need.h);
      fits = false;
      message = `The tables alone need ${mm(tablesMm)} mm, more than one A4 sheet holds — `
        + 'they will run onto a second page.';
    } else {
      scale = Math.min(area.w / need.w, room / need.h);
      fits = true;
      message = `Scaled to ${Math.round(scale * 100)}% so the board and its tables fit on one A4 sheet `
        + `— one hole is ${mm(PITCH_MM * scale)} mm.`;
      // One page, as asked — but say when that has made the board unusable.
      // Seen on the Yagi board with all three tables: 26%, a hole 0.6 mm.
      if (PITCH_MM * scale < MIN_READABLE_PITCH_MM) {
        readable = false;
        message += ' That is too small to build from: turn a table off, or use Fill the page '
          + 'and let the tables run onto a second sheet.';
      }
    }
  } else if (size === 'fill') {
    // ONE scale for every view — the largest at which they all fit — so the top
    // and the underside print the same size and compare hole for hole.
    scale = Math.min(area.w / need.w, area.h / need.h);
    fits = true;
    message = `Scaled to ${Math.round(scale * 100)}% to fill A4 — one hole is ${mm(PITCH_MM * scale)} mm.`;
  } else {
    fits = need.w <= area.w + 1e-9 && need.h <= area.h + 1e-9;
    const how = need.w > area.w && need.h > area.h ? 'too large'
      : need.w > area.w ? 'too wide' : 'too tall';
    message = fits
      ? `At actual size ${who} ${mm(need.w)} × ${mm(need.h)} mm, which fits on A4.`
      : `At actual size ${who} ${mm(need.w)} × ${mm(need.h)} mm, which is ${how} for A4 `
        + `and will be cut off. Fill the page will scale it to fit.`;
  }

  return {
    views: names.map((view) => ({ view, widthMm: drawing.w * scale, heightMm: drawing.h * scale })),
    scale,
    fits,
    readable,
    need,
    message,
  };
}
