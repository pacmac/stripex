# BUG — refs and values collide with each other on a dense board

status: in progress
area: editor-ui

Registered as `refs-and-values-collide-with-each-other`: *"On a board with parts close
together the ref/value text overlaps: 'LED1L4' and 'R3 330R' printed over the LED, 'C2 10n'
across the chip. Nothing positions a label with regard to any other label."*

## The change

Each part's label (its ref, and value if it has one) tries a short list of places in order
and takes the **first that overlaps no label already placed**:

1. above its first pin, where it goes today;
2. above the middle of its pins;
3. below its lowest pin;
4. to the right of its pins;
5. to the left of its pins.

If none is free it goes in the first place, as today. Labels are placed in board order, so
the result is the same every time the board is drawn.

**A board with no collisions looks exactly as it did**: every label's first choice is its old
place.

A label's box is estimated from its character count and font size. The same estimate is used
everywhere, and the renderer has no text measurement, which is a limit worth stating:
unusually wide glyphs could still touch.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | the label pass picks a free place |

## What a green run means

`tests/render/test_label_collisions.mjs`:

- on a board of resistors in adjacent columns with values, no two part labels' estimated
  boxes overlap;
- a lone part's label is exactly where it was: above its first pin.
