# GAP — the board cannot be printed

status: in progress
area: editor-ui

Peter, 2026-09-17: *"…and need a print button, prefereably with options to print in colours
and black and white, and to be able to print top and bottom on a single A4 sheet, either to
scale or fill to contents."* (The edge labels in the same message are `edge-labels-layer.md`,
already built. They matter here: on paper they are how you find a hole.)

## The change

A **Print** button in the toolbar, beside Export, opens a dialog with three choices and a
Print action:

| choice | options | default |
|---|---|---|
| Colour | **Colour** · **Black and white** | Colour |
| Sides | **Top** · **Underside** · **Both on one sheet** | Both on one sheet |
| Size | **Actual size** · **Fill the page** | Actual size |

Each is a segmented button group, not a dropdown. Peter asked for that trade before, and
with three choices on screen at once the whole sheet can be read before printing.

**The sheet is A4 portrait with 10 mm margins,** so the printable area is 190 × 277 mm. A
header line carries the board's name, the date, and the scale. Each view gets a caption:
*Top — the component side*, or *Underside — the copper side, mirrored*. Both views are
stacked on the one sheet.

**Actual size** means one hole is 2.54 mm on paper. The SVG is given its width and height in
millimetres, taken from the drawing's own viewBox, which is already in millimetres.
**The dialog says, before you print, whether it fits:** *"At actual size both views need
128 × 196 mm; they fit on A4."* or *"… need 190 × 310 mm; that is too tall for A4. Fill the
page will scale it down."* A board that does not fit can still be printed, and it will be
cut off, which the message has already said.

**Fill the page** scales every view by the same factor, the largest at which they all fit,
so the top and underside stay the same size as each other and can be compared hole for hole.

**Black and white is a theme, not a filter over the colour one.** A greyscale of the tan
board would print a grey rectangle and waste toner. The `mono` theme draws a white board,
black ink and outlines, pale grey copper, and white holes with black rings. The per-item
colours a board carries (a part's silkscreen, wire colours, net colours) are made grey on
the sheet, so nothing prints in colour when it was asked not to.

**What prints is what is shown:** the layers currently switched on, including the new row
and column labels, **without** check markers, a selection or a highlighted net. Those
belong to editing, not to a build sheet.

## The arithmetic is its own module

`src/render/print.js` is pure: given the drawing's size in millimetres, the sides and the
size choice, it returns each view's printed size, whether it fits, and the sentence the
dialog shows. Node can check the numbers without a browser, and the dialog and the sheet
cannot disagree about them.

## Files

| file | change |
|---|---|
| `src/render/print.js` | new: A4, margins, `printLayout` |
| `src/render/svg.js` | a `mono` theme |
| `public/index.html` | the button, the dialog, the print sheet |
| `public/app.js` | opening the dialog, building the sheet, calling print |
| `public/style.css` | the dialog; `@media print` shows only the sheet |

## Explicitly NOT changed

- The on-screen themes, and the board.
- Export as SVG, which stays as it is.

## What a green run means

`tests/render/test_print_layout.mjs`:

- a 30 × 14 board at actual size fits on one A4 sheet with both views, and each view's
  printed width in mm equals its drawing width;
- a board too tall for two views at actual size reports that it does not fit, and says to
  use Fill the page;
- fill gives both views the same scale, the largest at which both fit;
- the `mono` theme draws a white board and black ink.

`tests/browser/test_print_sheet.mjs`:

- the Print button opens a dialog with the three choices, and its message states the fit;
- choosing Black and white, Both on one sheet and Fill, then Print, builds a sheet with two
  views, top and underside, in the `mono` theme, with no check markers, and calls print;
- under print media the sheet is shown and the editor is not.
