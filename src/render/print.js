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
// Peter: "a 6mm margin is needed all around." The SHEET's own padding, not the
// @page margin: a page margin is where the browser prints its date, tab title
// and footer, and the print dialog overrides it (build-sheet-design.md).
export const PRINT_MARGIN_MM = 6;
// Kept off every sheet's height: the sheet is exactly A4 tall, and a fraction of
// a millimetre of pixel rounding past that prints its bottom padding on page 2.
export const PAGE_SLACK_MM = 1;

// A TABLE'S SIZE, COMPUTED NOT GUESSED. The stylesheet gives a table's title,
// header row and body lines these exact heights, and each column the width
// computed here, so One page can reserve room for the tables before it scales
// the board. Change one, change the other.
export const TABLE_GAP_MM = 4;
export const TABLE_TITLE_MM = 6;
export const TABLE_HEAD_MM = 5.1;
// A one-line row: 3.8 mm line, 0.5 mm padding above and below, 0.2 mm rule.
export const TABLE_ROW_MM = 5;
export const TABLE_LINE_MM = 3.8;
// 8.5 pt system sans: a column is sized at 1.6 mm a character (plus one glyph),
// close to what the text takes, so tables sit side by side; but a capped cell's
// wrapping is counted at 1.9, more than capitals and figures take, so One page
// expects more lines than print and errs toward space left over.
export const TABLE_CHAR_MM = 1.6;
export const TABLE_WRAP_CHAR_MM = 1.9;
export const TABLE_TITLE_CHAR_MM = 2;
export const TABLE_PAD_X_MM = 2;
export const TABLE_COL_MAX_MM = 60;
export const TICK_COL_MM = 6;
// Room left over on a One page sheet for the browser's pixel rounding.
export const ONE_PAGE_SLACK_MM = 3;
// Below this a printed hole is too small to build from, and One page says so.
export const MIN_READABLE_PITCH_MM = 1.5;

// The height the chosen tables will take, given each table's body row count.
// A table with no rows still prints its title and a "None" line.
export const tablesHeightMm = (rowCounts = []) => rowCounts
  .reduce((sum, rows) => sum + TABLE_GAP_MM + TABLE_TITLE_MM
    + (rows ? TABLE_HEAD_MM + rows * TABLE_ROW_MM : TABLE_ROW_MM), 0);
// The widths of a table's columns, the tick box first, and its height. Each
// column is as wide as its longest cell (or heading) up to TABLE_COL_MAX_MM; a
// table that would still be wider than the sheet has its widest columns capped
// further, and a cell longer than its column wraps onto more lines.
// { head: [...], rows: [[...]] } -> { w, h, cols: [mm] }
export function tableSizeMm(table, room = A4_MM.w - PRINT_MARGIN_MM * 2) {
  const { head = [], rows = [], title = '' } = table;
  const titleW = String(title).length * TABLE_TITLE_CHAR_MM;
  if (!rows.length) {
    return { w: Math.max(titleW, 'None on this board.'.length * TABLE_CHAR_MM), h: TABLE_TITLE_MM + TABLE_ROW_MM, cols: [] };
  }
  const longest = head.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)));
  // One glyph more than the longest cell: capitals and figures run wider than
  // TABLE_CHAR_MM, and "L11" in a column sized for three characters printed "L1 1".
  const colsFor = (cap) => [TICK_COL_MM, ...longest.map((n) => Math.min(cap, (n + 1) * TABLE_CHAR_MM) + TABLE_PAD_X_MM * 2)];
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  let cap = TABLE_COL_MAX_MM;
  while (sum(colsFor(cap)) > room && cap > 12) cap -= 1;
  const cols = colsFor(cap);
  const lines = rows.reduce((total, r) => total + Math.max(1, ...head.map((_, i) => {
    const chars = String(r[i] ?? '').length;
    const room = cols[i + 1] - TABLE_PAD_X_MM * 2;
    // A cell its column was sized for is one line; only a capped one wraps.
    if ((chars + 1) * TABLE_CHAR_MM <= room + 1e-9) return 1;
    return Math.max(1, Math.ceil((chars * TABLE_WRAP_CHAR_MM) / room));
  })), 0);
  return {
    w: Math.max(titleW, sum(cols)),
    h: TABLE_TITLE_MM + TABLE_HEAD_MM + rows.length * TABLE_ROW_MM + (lines - rows.length) * TABLE_LINE_MM,
    cols,
  };
}

// THE TABLES' BLOCK: placed left to right, a new row when the sheet's width runs
// out, each row as tall as its tallest table, TABLE_GAP_MM above every row and
// between tables. The stylesheet's flex-wrap does the same placing.
export function tablesBlockMm(tables = []) {
  const room = A4_MM.w - PRINT_MARGIN_MM * 2;
  let height = 0;
  let rowW = null;
  let rowH = 0;
  for (const t of tables) {
    const { w, h } = tableSizeMm(t, room);
    if (rowW !== null && rowW + TABLE_GAP_MM + w <= room + 1e-9) {
      rowW += TABLE_GAP_MM + w;
      rowH = Math.max(rowH, h);
    } else {
      height += rowW === null ? 0 : TABLE_GAP_MM + rowH;
      rowW = w;
      rowH = h;
    }
  }
  return rowW === null ? 0 : height + TABLE_GAP_MM + rowH;
}

// Board name centred, scale left, date right, one hairline under them.
export const HEADER_MM = 10;
// "Top, component side" under each view.
export const CAPTION_MM = 6;
// Between the two views when both are on the sheet, across or down.
export const GAP_MM = 6;

// The space left for the DRAWINGS themselves, once margins, the header, a
// caption per view and the gap between them are taken out. Stacked views share
// the height; side by side they share the width.
export function printableMm({ views = 1, arrangement = 'column' } = {}) {
  const w = A4_MM.w - PRINT_MARGIN_MM * 2;
  const h = A4_MM.h - PRINT_MARGIN_MM * 2 - PAGE_SLACK_MM - HEADER_MM;
  return arrangement === 'row'
    ? { w: w - GAP_MM * (views - 1), h: h - CAPTION_MM }
    : { w, h: h - CAPTION_MM * views - GAP_MM * (views - 1) };
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
export function printLayout({ drawing, sides = 'both', size = 'actual', tablesMm = 0, arrangement: asked } = {}) {
  const names = sides === 'both' ? ['top', 'underside'] : [sides === 'underside' ? 'underside' : 'top'];
  const n = names.length;
  // SIDE BY SIDE OR STACKED, whichever prints the views larger in the room this
  // size leaves them, so a tall board uses the page's width. Stacked on a tie.
  const shape = (arr) => {
    const area = printableMm({ views: n, arrangement: arr });
    const need = arr === 'row' ? { w: drawing.w * n, h: drawing.h } : { w: drawing.w, h: drawing.h * n };
    const room = size === 'onepage' ? area.h - tablesMm - (tablesMm > 0 ? ONE_PAGE_SLACK_MM : 0) : area.h;
    return { arr, area, need, best: Math.min(area.w / need.w, room / need.h) };
  };
  const column = shape('column');
  const row = shape('row');
  const chosen = asked === 'row' || asked === 'column' ? shape(asked)
    : n === 2 && row.best > column.best ? row : column;
  const { area, need } = chosen;
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
    arrangement: chosen.arr,
    viewsWidthMm: need.w * scale,
    viewsHeightMm: need.h * scale,
    scale,
    fits,
    readable,
    need,
    message,
  };
}
