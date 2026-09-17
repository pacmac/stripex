# BUG — print: layers per side, 6 mm margins, A4 widths, and fit on one page

status: in progress
area: editor-ui

Peter, 2026-09-17: *"there are several issues: 1) I need to set what layers are visible for
top/bot seperatly (i.e 2 cols of checkboxes, 1 for top and 1 for bottome. 2) a 6mm margin is
needed all around. 3) the table width appears not to be correct width for A4 paper (maybe
page size needs to be defined ?) 4) an option to fit on 1 page would be good as now it flows
onto 2 pages, with ONLY the BOM selected, and it's not really a very big BOM"*

Builds on `print-view.md`.

## Measured before changing anything

On a copy of the Yagi board, printing both sides, Fill the page, BOM only:

- **2 pages** in Chromium's A4 PDF;
- the sheet and its BOM table are **423 mm** wide under print media: the sheet has no width
  of its own and takes the window's, while the views are 121 mm. That is Peter's point 3,
  and his guess is right: the page's width has to be stated.

## The change

**1. Layers per side.** The Layers section becomes a grid: one row per layer, a **Top**
column and a **Bot** column of checkboxes. Each view prints its own set. Remembered, and a
remembered set from before this change applies to both columns.

**2. 6 mm margins** on all four sides: `@page { margin: 6mm }`, `PRINT_MARGIN_MM = 6`, and the
preview page padded the same, so the arithmetic, the preview and the paper agree. The
printable area is 198 × 285 mm.

**3. A4 widths stated.** The sheet is exactly 198 mm wide on paper and in the preview. Tables
are 100 % of that and fixed-layout, so a long ref list wraps in its cell instead of widening
the table.

**4. One page** is a third Size choice: *Actual size · Fill the page · One page*. The views
are scaled by one factor, the largest at which the views and the chosen tables fit on one A4
sheet. The tables' height is computed, not guessed: a table row, its header and a title are
given fixed heights in mm in the stylesheet, and `print.js` uses the same numbers. The dialog's
sentence says *"Scaled to 87 % so the board and its tables fit on one A4 sheet"*. If even a
tiny board cannot make the tables fit, it says so.

## Files

| file | change |
|---|---|
| `src/render/print.js` | 6 mm margin; `tablesHeightMm`; the `onepage` size |
| `public/index.html` | the One page choice |
| `public/app.js` | per-side layers; the sheet's width; tables' heights into the layout |
| `public/style.css` | 6 mm margins; 198 mm sheet; fixed table geometry |

## What a green run means

`tests/render/test_print_layout.mjs`:

- the printable area is 198 mm wide;
- One page scales the views down so their height plus the tables' height fits the page, and
  says so; with no tables it is the same as Fill.

`tests/browser/test_print_view.mjs`:

- the Layers grid has a Top and a Bot checkbox for each layer; turning a layer off for Bot
  leaves it on the top view and off the bottom view; remembered across a reload;
- under print media the sheet is 198 mm wide and its table no wider;
- **both sides, One page, BOM on: Chromium's A4 PDF of the sheet is 1 page.**
