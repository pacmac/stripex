# GAP — the board has no row letters or column numbers at its edges

status: in progress
area: editor-ui

Peter, 2026-09-17: *"another layer is needed at the outer edges of the board showing the
rows (A-Z, AA...etc) and columns 1,2,34,.... etc. must be a layer."* (The same message asks
for printing, which is its own spec: `print-sheet.md`.)

## What is wrong

Nothing on the board says where a hole is. Findings say `(5,5)`, zero-based; a person
counting holes on a real board counts from one, from a corner, and loses count by the
twentieth.

## The change

**A layer, `edgeLabels`, "Row and column labels", on by default,** listed in the Layers
card beside Refs and values.

- **Rows are lettered** A, B … Z, AA, AB … top to bottom. That is the bijective base 26
  `columnLabel` already in `src/model/labels.js`, which pen wires use, so there is one
  lettering in the project and not two.
- **Columns are numbered** 1, 2, 3 … left to right.
- **On all four edges:** letters left and right, numbers top and bottom, so a label is
  beside a hole wherever you are looking on a large board.
- **In the underside view the columns mirror with the board,** so column 1 is on the right
  there. Every label takes its position from its hole's drawn position, so this needs no
  special case.
- Drawn at a caption's weight, in the ink colour at reduced opacity, with no pointer
  events. It is a ruler, not an object.

## Room for it, and the net names already out there

The labels need a band just outside each edge. The left and right margins are already
used: a net name on a strip that reaches an edge is drawn **outside the board at 0.35 of a
pitch**. Drawn as they are, the labels and those names would sit on top of each other.

So:

- a band of `EDGE_LABEL_BAND_MM` (0.9 of a pitch) on all four sides, **always reserved,
  whether the layer is on or not**, for the reason the net-name gutter is always reserved:
  a board that changes size when a layer is switched is a board that jumps under the
  pointer;
- a net name pushed off an edge now starts **outside that band**;
- the window grows by the band at the top and bottom as well.

## Where it must NOT appear

The Library footprints and the Components preview are drawings of one part on a scrap of
board, not a board you locate holes on, so both switch the layer off.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | the layer, the band, net names moved out past it |
| `public/app.js` | the Layers card row; off in the footprints and the Components preview |

## What a green run means

`tests/render/test_edge_labels.mjs`:

- `DEFAULT_LAYERS.edgeLabels` is true;
- a 30 × 12 board draws rows A … L on both sides and columns 1 … 30 top and bottom, and a
  28-row board's last row is AB;
- with the layer off, none are drawn, and the window is the same size;
- in the top view column 1 is left of column 2; in the underside view it is right of it;
- no label lies inside the board, and none overlaps a net name pushed off an edge.
