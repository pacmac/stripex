# SPEC — the net name layer is the top layer

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  bd6aa404ac77c8c3dd2fdc3b4364ef1d807328a9053d8bb610fd0847100c1a80
  public/app.js:      50bb3df77c714f126233969e6fd4e855272fca6a6a00c0c799dd244ef220108a

Peter, 2026-08-30: *"I think that the Net Name Layer should be the Top Layer."*

## What this reverses, and why he is right

`docs/specs/net-name-plate.md` put the name pass at **4b**, between the holes and the wires,
and argued for it:

> Wires and components stay on top on purpose. They are objects on the board; the name is
> annotation *of* the board, and a link that crosses a labelled strip has to be visible where
> it lands.

That reasoning holds for a **photograph** of a finished board. It is wrong for a **layout
editor**, and the difference is what the picture is for. The names are the thing you read the
board *by* — GND, +5V, the signal you are tracing — and a caption you have to move a part to
read is a caption that has stopped working. The very case that argued for putting parts on
top, a DIP sitting across a labelled strip, is the case where the name matters most and is
exactly the one where it disappeared.

A crossing wire stays perfectly legible under a 1.8 mm pill: it emerges either side of it,
and its own pads are elsewhere. A name under a component body does not, because the body is
larger than it is.

## The move

The pass goes from 4b to **7b** — after the check markers, before the hit targets:

```
1 substrate  2 copper  3 breaks  4 holes  5 wires  6 components  7 DRC  [7b net names]
8 hit targets  9 move handle
```

**Not literally last.** Two things stay above it, and neither is a picture of the board:

- **hit targets** (8) are invisible rectangles that exist to be clicked. A name is
  `pointer-events="none"`, so this changes nothing you can see and keeps the cut under a
  component clickable.
- **the armed move handle** (9) is drawn last on purpose — *"so nothing covers the pin you
  are moving"*. A pill covering the pin you are dragging would be the same defect in a new
  place.

So: the topmost thing **drawn as board graphics**, with only the two interaction affordances
above it.

## And the row moves with it

`LAYER_ROWS` reads roughly top-of-stack downwards, so `Net names` moves from after **Holes**
to the **head of the list**. A layers list that disagrees with the drawing order is a second
description of the same fact, and this project has paid for that shape twice already.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | the net-name pass moves from 4b to 7b |
| `public/app.js` | `Net names` becomes the first row in the Layers card |

## Explicitly NOT changed

- The plate itself: colour, pill, padding, the shrink-to-fit and the drop below 0.76 mm.
- Which nets are named, and how. Untouched.
- The `netNames` layer switch and its default.
- Hit targets and the move handle stay above it, for the reasons above.

## What a green run means

`tests/render/test_net_name_plate.mjs` reports `N/N checks passed`, with its ordering checks
inverted: the plate is drawn after the holes **and after the wires, the component bodies and
the check markers** — while the move handle is still drawn after the plate.

Plus, in a real browser: a DIP placed across a named strip, and the name still readable.
