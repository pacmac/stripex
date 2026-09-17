# GAP — print is a dialog in the header, forgets its choices, and prints no tables

status: in progress
area: editor-ui

Peter, 2026-09-17: *"rename Underside -> "Bot", add another button print. popup a modal with
the print options, and the layers to show, such that it renders a panel where top / bot
would be. also include option to include table for BOM, and maybe others. the layer
selection and print settings should persist so that each time I print I wont have to
re-select everything. this panel should have a print button, probably top right rather than
being in the header as it is now"*

This supersedes the dialog half of `print-sheet.md`. The arithmetic (`src/render/print.js`)
and the `mono` theme stay.

## The reading, said to Peter before building

The view group becomes **Top | Bot | Print**. **Print is a view:** it takes the board's
place in the stage and shows a print panel, with the settings, the layers and the tables on
one side, a live A4 preview beside them, and **Print** at the top right. The header Print
button and its dialog go. If "modal" meant a floating dialog over the page, that is a small
change afterwards.

## The change

**Top | Bot | Print.** "Underside" is renamed "Bot" wherever a person reads it: the view
button, the print choice, and the caption on the sheet (*Bot — the copper side, mirrored*).
The internal view name stays `underside`, because stored preferences and every check use it.

**The Print view** replaces the board in the stage. The tools do nothing while it is shown,
and Top or Bot returns to the board as it was.

| part | contents |
|---|---|
| bar, full width | *Print*, the fit sentence from `printLayout`, and **Print** at the right |
| options column | **Page:** Colour / Black and white · Top / Bot / Both · Actual size / Fill the page. **Layers:** one checkbox per layer in the Layers card (not check markers, which never print). **Tables:** Bill of materials · Cut list · Wire runs |
| preview | the sheet itself, drawn on an A4-proportioned page and scaled to the pane |

**One sheet, two places.** The preview and what goes to the printer are built by the same
function from the same settings, so the preview cannot show something the paper does not.

**The tables** follow the views and continue onto a second page if they need to:

- **Bill of materials:** one row per distinct thing, with Qty, Refs, Value and Part. A
  device is named as the device (*SOT-23 MOSFET*), a part by its name, and wire links by
  their length (*Wire link, 4 holes*). Refs are in natural order: R2 before R10.
- **Cut list:** every cut, derived ones included, located by the row letters and column
  numbers now printed at the board's edges. A knife cut is *C 4|5* (row C, between columns
  4 and 5) and a spot-face is *C5*.
- **Wire runs:** each pen wire's ref, from and to, in the same hole names.

**Everything persists** per viewer, in `localStorage` under `stripex.print`: the page
choices, which layers print, and which tables. It is a preference, like the layers, and no
board data is kept there. The first time, the print layers start from the layers shown on
screen; after that they are their own.

## Files

| file | change |
|---|---|
| `public/index.html` | Bot; the Print view button; the print panel; the header button and dialog removed |
| `public/app.js` | the view; building the sheet once for preview and paper; persistence |
| `public/style.css` | the panel, the preview page, the tables on paper |
| `src/model/views.js` | `bomFor(project)` |
| `src/render/print.js` | `holeName`, and the cut and wire rows in hole names |

## What a green run means

`tests/model/test_bom.mjs`:

- two 10k resistors make one BOM row, Qty 2, refs R1, R2; a device is named as the device;
  wire links are grouped by length; refs sort naturally;
- `holeName(4, 2)` is C5; a knife cut between columns 4 and 5 on row C reads *C 4|5*, and a
  spot-face reads *C5*.

`tests/browser/test_print_view.mjs`:

- the view group reads Top, Bot, Print, and the header has no Print button;
- Print shows the panel in place of the board, with Print at its top right;
- turning on the BOM puts a BOM table in the preview; turning off a layer removes it from
  the preview;
- the choices survive a reload;
- Print builds the same sheet for paper and calls print, and under print media only the
  sheet shows;
- Top brings the board back.
