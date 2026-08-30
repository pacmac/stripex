# SPEC — one click for the view, and icons for the actions

status: implemented, entries CLOSED
area: editor-ui
source_hash:
  public/index.html:  30ebe1d6fd29306692a7c483a8142a95fb5f6f14e6f8d6171d6b8827b6b8c6b2
  public/app.js:      b94a9aaf4223ab92be7b18ef8dd7620c728553e57698aaa497b63900160c5706
  public/style.css:   c5887cb4e691749c5c60d55fe7bc78e596ab79a9c48ff4f2af779915c9b53177

Also carries `a-board-cannot-be-resized`: the Board card and the toolbar both used
`id="cols"`, so `$('#cols')` always found the toolbar's — the card's inputs never got a
handler and the toolbar's only got one after the card had been opened once, bound from inside
the card's painter. The size lives in the toolbar alone now, wired once at boot.

Peter, 2026-08-30: *"the dropdown for top bottom can be a button group instead. faster."* and
again *"at the same time the Top and Bootom dropdown can be changed to a button group"*, and
*"the action buttons with text at the top can be changed to icons."*

## The view

Two options behind a `<select>` costs **two clicks and a menu** — open it, read two lines,
choose. A two-button group costs **one click**, and shows which side you are looking at
without opening anything, which the dropdown only does if you read its text.

```
[ Top ][ Underside ]        one lit, the other not
```

The armed one is marked the way the tool buttons already are — `is-on` — so the toolbar has
one idiom for "this is the current one" rather than two.

The `#view` element is read in three places in `public/app.js`. It becomes
`[data-view="top"|"underside"]` buttons and one handler, and `state.view` stays exactly what
it was, so nothing downstream changes.

## The actions

`Rotate Undo Redo Download Upload Restore Export SVG` are seven words in a bar that already
overflows at 1280 and scrolls. As icons they stop competing with the six tool buttons, which
are the ones you actually reach for while drawing.

| | icon | title |
|---|---|---|
| rotate | ⟳ | Rotate (R) |
| undo | ↶ | Undo (Ctrl+Z) |
| redo | ↷ | Redo (Ctrl+Shift+Z) |
| download | ⭳ | Download a copy of this board as a file |
| upload | ⭱ | Open a board from a file on this machine |
| restore | ⭯ | Go back to an earlier snapshot |
| export | ⧉ | Export the board as an SVG |

**Every one keeps a `title`, and gains an `aria-label`.** An icon with no name is a puzzle,
and a toolbar of unlabelled glyphs is the thing people complain about in every editor that
has one. The tooltip is the label; the keyboard shortcut stays in it where there is one.

## The tools, and the grouping

Peter, after seeing the first pass: *"delete, move, wire, break, place, select also need to be
icon only. might also need to do some logical grouping of these buttons."*

So the six tools lose their words too, and the bar is grouped **by what a tool does to the
board** rather than by how often it is used:

| group | buttons |
|---|---|
| act on what is there | select · move · rotate · delete |
| add something new | place · wire · break |
| history | undo · redo |
| view | top · underside |
| document | size · boards · save state |
| file | theme · download · upload · restore · export |

Rotate moves out of the history group and in with the tools that act on an existing part,
which is what it does. A separator between each group, so the eye finds the group before the
button.

## The icons are DRAWN, and the first set was not

The first pass used typographic glyphs — `⟳ ↶ ↷ ⭳ ⭱ ⭯ ⧉` — and Peter's verdict was *"the icons
you have chosen are tiny / illegible, impossible to figure out what a button is for !"*.

He was right, and the reason is worth keeping: a font glyph renders at whatever size and
weight the font decides, several of those characters have no glyph in common fonts and fall
back to a box, and none of them is a shape anyone has been taught. They are now 24×24 SVG
symbols stroked in `currentColor` — they take the button's own colour in both themes, cannot
fall back to a box, and are the shapes other editors use.

A check asserts every icon button has a **drawn** icon at least 14 px on a side, as well as a
title and an aria-label, so this cannot regress to glyphs.

## Files

| file | change |
|---|---|
| `public/index.html` | the view becomes two buttons; the action buttons become icons with titles and aria-labels |
| `public/app.js` | one handler for the view buttons in place of the select |
| `public/style.css` | `.iconbtn`, and the view group marked like the tools |

## Explicitly NOT changed

- `state.view` and every use of it.
- The six tool buttons and their labels.
- The Boards button, which carries the board's name and is not an action.
- The board size inputs.

## What a green run means

`tests/browser/test_layout.mjs` reports `N/N checks passed`:

- **there is no `<select>` in the toolbar** — the measurement that says the dropdown is gone;
- two view buttons exist, exactly one is lit, and clicking the other flips which;
- clicking `Underside` actually turns the board over — checked by the board mirroring, not by
  the button's own class;
- **every icon-only button in the toolbar has an accessible name** — a `title` and an
  `aria-label` — so none of them is a glyph you have to guess;
- the toolbar still fits or scrolls at 1600, 1280 and 1440×720, which the existing check
  already asserts and must keep asserting.
