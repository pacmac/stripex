# SPEC — the drawing is as big as what is drawn, and a land has no pin 1

status: implemented, both entries CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  9fc28ec14c667da731e0406b5f4f5f4b530f54902ab3e2f05f0c65af31660964

Peter, 2026-08-31, on the board he is laying out:

> *"in my design the JST 3 pin connector is now partly obscured hidden at the overflow at the
> top, so the board size / auto zoom will need to include the extents of any component
> footprints on the board and not just the board size itself. for smt resistors, both ends /
> pins should be a square footprint and not one round and one square."*

Two defects, both surfaced by the JST body being corrected to its real size.

## 1. The drawing is clipped to the board

```js
viewBox="${-gutter} 0 ${w + gutter * 2} ${h}"
```

The height is exactly the board's, starting at y = 0, and the width is the board plus a fixed
net-name gutter. **Nothing accounts for a body that reaches beyond the board**, so a
right-angle JST on the top row has its housing cut off — it lies 9.2 mm past its pin row and
there is simply no canvas there.

This was latent before and is visible now: at the old, too-small size the same connector
fitted. Correcting one drawing exposed the other.

**A part hanging over the edge must still be DRAWN**, because that is exactly the case a
person needs to see — it is telling you the connector does not fit where you put it. Cropping
it turns a placement problem into an invisible one.

### The change

`drawingExtentMm(project)` — the union of the board rectangle and every placement's body
extent — feeds the viewBox. The board keeps its net-name gutter; the extent adds whatever a
body needs beyond that, and only when something needs it.

**The shape constants are shared, not restated.** The JST numbers move to module scope so the
body that draws them and the extent that measures them read the same names. Where a shape's
outset is arithmetic rather than a constant (a `can`'s radius is half its longer side, a
`hole`'s is its own), the extent uses the same expression, and a check renders every part at
every rotation and asserts nothing is drawn outside the reported extent.

## 2. An SMT land is drawn with a pin 1 it does not have

```js
out.push(i === 0 ? `<rect .../>` : `<circle .../>`);
```

Square for pin 1, round for the rest. That is right for a DIL or a connector, where pin 1 is a
real feature of the part and the square is how you find it.

**An 0603 has two identical rectangular lands and no pin 1.** Drawing one square and one round
invents an orientation the part does not have, on the parts where orientation matters least.

### The change

A **copper-side** part — one whose pins are lands soldered to the track rather than leads
through a hole — draws **every** pad square. Pin-1 marking is unchanged for everything else.

Keyed on `sideOf(part) === 'copper'` rather than on the part's id, so the rule is about what a
land is rather than about which two entries happen to be SMT today.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | `drawingExtentMm`, the viewBox, the shape constants, the pad shape |

## Explicitly NOT changed

- The net-name gutter, which is deliberately always present so a board does not resize when a
  rail is named.
- The pin-1 square on through-hole parts, which is how you orient a DIL.
- Hit-testing and the hole coordinate system: `holeToMm` still measures from the board's
  top-left corner, and the extent only moves the window, never the board.

## What a green run means

`tests/render/test_extents.mjs` reports `N/N`:

- a right-angle JST on the **top row** produces a viewBox whose top is above the board, and
  one at the **left edge** widens it — so the body is inside the drawing;
- a board with nothing overhanging keeps the viewBox it has today, gutter included, so
  ordinary boards do not move;
- **every part in the library, at 0/90/180/270, draws nothing outside the reported extent** —
  the check that stops the extent and the drawing drifting apart;
- both pads of an `smt-0603` and an `smt-0603-cap` are rectangles;
- a `dip`'s pin 1 is still a square and its pin 2 still a circle;
- and the pads still carry `data-pin` and `data-first`, because the editor hit-tests on them.

## Three things the checks found that the spec had not

**The extent has to go through the same transform the drawing does.** The first version worked
out which board direction "in front of the pin row" pointed in by looking at whether the pins
ran horizontally or vertically. That is the same arithmetic done twice, and it was wrong at
rot 180. It now applies `rotate(angle)` to the same local rectangle the body is drawn from.

**The latch stands proud of the shroud**, so on a straight connector it is the thing that
reaches furthest — the extent covered the shroud and left the latch outside. `JST_RAMP_PROUD_MM`
is now named and read by both.

**The left edge did not need the extent at all**, and the check that said it did was wrong. A
right-angle body reaches at most 9.2 − 1.27 = 7.93 mm past the left edge and the net-name
gutter is already 8.13 mm. The check now asserts the body is *contained*, which is the actual
requirement; asserting the window moved was asserting an implementation detail.

The "every part at every rotation" check was also vacuous as first written — it placed parts
mid-board, where nothing can overhang, so it passed before the fix. It now places each part at
five positions including all four edges.
