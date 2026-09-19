# BUG — a part's ref prints over another part's pad

status: done
area: editor-ui

Found while checking the printed build sheet on a copy of the Yagi board: **3 of its 16 part
labels sit on another part's pad** — `L5` on one of J1's pads, `L6` on one of U1's, `J2` on a
link's. A pad you cannot read is a hole you cannot find, and on a printed build sheet there is
nothing to click to move the label out of the way.

`docs/specs/labels-dont-collide.md` gave each label a list of places and took the first that
hit no label already placed. **Pads were never in that list**, so a label avoids its
neighbour's text and lands on its neighbour's pad instead.

## What counts as occupied

Only the pads of OTHER parts. Three things deliberately stay allowed:

- **the board's own holes** — a label has to cross them on any populated board, and the drawn
  pads are what carries a part's identity;
- **the part's own pads** — the candidates sit outside them already, and a long wire link whose
  ref is pushed off its own line would read worse;
- **silkscreen bodies and outlines** — ink over an outline is legible, ink over a pad is not.
  `TMC2209` crossing the top of its own package is not this bug.

A body is **preferred** clear, though, and only breaks a tie: with pads alone as obstacles,
`L6` moved off a pad and landed in the middle of `U1`'s package, where it read as `U1`'s own
label. So every candidate is tried against pads AND other parts' bodies first, and only if
none is free are the bodies dropped and the pads alone decide. A link has no package, so its
own line never blocks anything.

A pad's box is its centre plus `PAD_R_MM`, the radius the renderer draws. Every placement's
pads are worked out BEFORE any label is placed, so a label avoids a part drawn after it as
well as one drawn before — otherwise the first part on the board could never be told about the
last.

## The change

`placeLabel` gains the pad boxes and tests a candidate against labels and pads together. The
first five candidates and their order do not change, so **a label with a free first choice
stays exactly where it is**, and a label with nowhere free still falls back to its first choice
rather than flying off somewhere unpredictable.

Four candidates are added after those five — beside the first pin left and right, and a whole
hole further out above and below — because on the 555 board `R3` found its five places all
taken and fell back onto a neighbour's pad.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | the label pass treats other parts' pads as occupied |

## What a green run means

`tests/render/test_label_collisions.mjs`:

- on a board with a wire link beside a 14-pin socket, no part label's box overlaps a pad that
  belongs to another part;
- the two checks already there still pass: no label over another label, and a lone part's label
  is still above its first pin.
