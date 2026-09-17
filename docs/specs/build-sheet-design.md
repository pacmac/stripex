# BUG — the printed sheet has browser headers, no margins, a padded full-width BOM, and wastes the page

status: done
area: editor-ui

Peter, 2026-09-17: *"there are still no margins when printing. you can remove the date / time
and "stripex - stripboard editor" printed in the header you can centre the board name /
title, show the date in the header right, and omit the footer. the Bill of materials does not
need to be full page width. and looks terrible because of all of the whitespace padding.
/frontend-design:frontend-design - this page could be much better."*

## What was really happening

- **The date/time, "stripex – stripboard editor" and the footer are the browser's**, not the
  sheet's. Chromium prints its own header and footer inside the `@page` margin, using the tab
  title. A page cannot switch them off, but it can leave no room for them.
- **"No margins"**: `@page { margin: 6mm }` is only a request. The print dialog's own margin
  setting overrides it, so the sheet's margin depended on how the dialog was set.

## The fix for both

`@page { size: A4; margin: 0 }`. With no margin box, Chromium prints no header or footer. The
**sheet pads itself 6 mm on every side**, so the margin is part of the page and no dialog
setting removes it. While printing, `document.title` is the board's name, so a browser that
still prints a header (Firefox, when its own checkbox is on) prints something true.

## The design

The subject is a build sheet: used at a bench with a pencil, often in black and white.

- **Palette:** paper `#FFFFFF`, ink `#000000`, secondary ink `#555555`, hairline `#BBBBBB`. No
  accent, because it must survive a mono printer.
- **Type:** the system sans. Title 14 pt bold; body and tables 8.5 pt with tabular figures; no
  all-caps labels and no monospace.
- **Header:** scale on the left in secondary ink, **the board's name centred**, **the date on
  the right**, one hairline under it.
- **Views:** for Both, the top and the bottom views are placed **side by side** or **stacked**,
  whichever prints them larger, so a tall board uses the page's width. Captions under each view,
  centred, in sentence case: *Top, component side* and *Bottom, copper side, mirrored*.
- **Tables:** as wide as their content, never the page. Compact: 0.6 mm by 2 mm cell padding,
  hairline rules between rows, a bold header row, no fill. **Placed side by side** and wrapping
  when the page runs out of width.
- **The one bold element: a tick box on every table row**, the first column, an empty 3 mm
  square. A build sheet is worked down part by part and cut by cut, and ticking is how.

## One page still fits, on the new geometry

`print.js` gains the arithmetic for both new layouts:

- `viewsLayout`: stacked or side by side, whichever gives the larger scale;
- `tablesBlockMm(tables)`: each table's width estimated from its longest cell per column
  (8.5 pt at 1.6 mm a character plus one glyph, so tables really do sit side by side), a column
  capped at 60 mm whose cells wrap, their lines counted at a generous 1.9 mm a character; tables
  packed left to right into rows 198 mm wide, and each row as tall as its tallest table.
- The views' test board is 12 × 34: 12 × 19 draws square once its gutters are counted.

Row, header and title heights are fixed in millimetres in the stylesheet, and the same numbers
are in `print.js`.

## Files

| file | change |
|---|---|
| `src/render/print.js` | view arrangement; table packing; header and caption heights |
| `public/app.js` | the header, captions, tick boxes, title while printing, arrangement |
| `public/style.css` | `@page` margin 0 with the sheet's own 6 mm; the design |

## What a green run means

`tests/render/test_print_layout.mjs`:

- for Both on a board taller than wide, the views go side by side, at a larger scale than
  stacked;
- two narrow tables pack into one row: the block is as tall as the taller one, not both added.

`tests/browser/test_print_view.mjs`:

- under print media, `@page` has margin 0 and the sheet is padded 6 mm;
- the title is centred on the sheet and the date is at its right edge;
- `document.title` is the board's name while printing and is restored after;
- a small BOM is well under the page width, and a BOM and a cut list sit side by side;
- every table row starts with a tick box;
- both sides, One page, BOM on: still one A4 page.
