# SPEC — the panel goes to the net, and the card says which board

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  public/app.js:      4c1c740874ec2f11423b25c0143f8efe1f7f48cf0dc7d032876a9cfed0bdb28f
  public/index.html:  f5c2af3b5d87c2bd83668d15b5ae175460414624ee92a152e12b18d285fcb335
  public/style.css:   b8b97f6edaeb760601650c2d3c9e473e1f63ba1cc8b98b5f20f6bf697a043bbf

Peter, 2026-08-30: *"when a net / strip is selected, as well as the net being highlighted in
the right panel, it also needs to scroll it to the top."*

Plus two defects the first real browser verification of the board server turned up.

## 1. The marked row can be off screen

Selecting a strip already opens the Nets tab and marks that net's row — `net-selection-both-
ways.md`. On his own board that list is **27 rows long** and the panel shows about eight, so
the row it marks is usually somewhere you cannot see. The feature works and looks like it does
not, which is the worst of both.

**Scroll it to the top**, not merely into view. `scrollIntoView({block: 'nearest'})` would leave
a row that is already visible where it is, and Peter asked for the top: a fixed landing place
means the eye knows where to go without hunting, and the rows below it are that net's
neighbours in the same run.

Only when the selection **changes**, and only when the selection came from the board. Scrolling
the list under the pointer while somebody is clicking down it would be its own defect.

## 2. You cannot see which board is open

Measured in a browser: the Board card's subtitle reads `25 × 20`. The card is **collapsed by
default**, so the board's name — the whole point of the work that just landed — is invisible
until you expand a card and look at a field.

The subtitle becomes the **name**, which is what identifies the document; the size stays
inside the card next to the two inputs that set it.

## 3. The board list runs its words together

Measured: a row reads `recovered 2026-08-3014 parts`. The name and the part count have no
separator because `.board-list .kind` never got the left margin `.palette .kind` has.

## Files

| file | change |
|---|---|
| `public/app.js` | scroll the marked net row to the top; the board card subtitle shows the name |
| `public/style.css` | `.board-list .kind` gets its margin |

## Explicitly NOT changed

- Which tab a selection opens, and the marking itself. Both already work.
- The board list, the name field, and everything else in the Board card.
- Scrolling on any other panel.

## What a green run means

`tests/browser/test_layout.mjs` reports `N/N checks passed`, in a real browser because none of
this is measurable anywhere else:

- with a board whose net list is longer than the panel, clicking a strip **near the bottom**
  leaves that net's row at the top of the scrolled panel — measured as the row's offset from
  the panel's top, not as "a scroll happened";
- the row is still marked;
- the Board card's header shows the open board's **name** while the card is collapsed;
- the size is still shown inside the card.
