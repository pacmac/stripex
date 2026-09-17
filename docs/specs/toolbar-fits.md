# BUG — the toolbar scrolls its last buttons out of sight below 1920 px

status: in progress
area: editor-ui

Found while checking the Wire link button, 2026-09-17: at 1440 px the toolbar's last buttons
had scrolled out of the visible bar. Print has since left the header, but Theme, Download,
Open, Restore and Export are still hidden at 1440.

Peter was asked twice how he wanted it arranged, then went AFK. This is the decision taken
while he was away, and how to reverse it.

## Measured

At 1920 px, on a scratch board with a long name (*yagi v5 control board copy*), the toolbar's
natural width is about **1658 px**:

| group | width |
|---|---|
| theme, download, open, restore, export | 200 |
| board button (grows with the board's name) | 216 |
| board size: label and two inputs | 188 |
| separators, at the padding Peter asked for | 96 |

## The decision

- **One ⋯ More button** at the right holds **Theme, Download a copy, Open from a file,
  Restore a snapshot and Export as SVG**, each with its icon and its words. It saves about
  164 px. They are the actions used least often while laying out a board, and they are
  about the file and the display, not the board.
- **The board name is capped** at 130 px with an ellipsis, and the full name is its tooltip.
- **The size inputs are narrower**: four digits fit in 50 px.

**Not done, deliberately:** moving the size inputs into the Board card. They were there
once, with duplicate ids, the card's pair never had a handler, and Peter could not resize a
board. They were put in the toolbar to fix that (see `paintBoardCard`), and moving them back
would reopen it.

**The buttons keep their ids** inside the menu, so every existing handler still fires. The
menu is positioned **fixed** from its button, because the bar scrolls horizontally and would
clip anything absolutely positioned inside it. It closes on a choice, on Escape, and on a
click elsewhere.

**To reverse:** move the five buttons out of `#moreMenu` back into their group in
`index.html`, and delete the menu.

## Files

| file | change |
|---|---|
| `public/index.html` | the More button and menu; the five buttons inside it |
| `public/style.css` | the menu; the capped name; the narrower inputs |
| `public/app.js` | opening and closing the menu |

## What a green run means

`tests/browser/test_toolbar_fits.mjs`, on a board with a long name:

- at 1440 and 1600, no toolbar button lies outside the visible bar;
- the More menu opens, lists Theme, Download, Open, Restore and Export, and closes on
  Escape;
- choosing Theme from it switches the theme and closes the menu;
- the board button's full name is its tooltip.
