# SPEC — pin 1 top-left, and outlines derived from the pins

status: implemented, both entries CLOSED
area: component-library, editor-ui
source_hash:
  src/parts/library.js:  e68b0028bc41f59a8d534e27cad1b15c32d28b8372d37c6e68e154c73a90d9d3
  src/render/svg.js:     e57bfd8ce9b3ded71eb7d6215fd11824ac2896763d58da136d8c2f526d241ad5

## What the browser actually did

Red 2/12 → green 12/12, both entries closed. 16 suites, 254 checks.

A DIP-14 turned to straddle the strips, pin positions read off the drawn pads:

| claim | result |
|---|---|
| pin 1 is the top-left pin | yes |
| pin 2 is directly below pin 1 | yes |
| pin 8 is bottom-right | yes |
| pin 14 is opposite pin 1, same row | yes |

## A correction: the outlines were not as oversized as I claimed

Filing `component-outlines-are-drawn-far-larger-than-the-real-parts`, I said a 2-hole
electrolytic drew an 8.1 mm circle "for a part that is about 5 mm". That was wrong. Two
holes of pitch is **5.08 mm between leads**, which is a 10 mm can, not a 5 mm one — so 8.1 mm
was roughly right. The entry was withdrawn and refiled against this spec, where the real
fault is stated properly: the size came from a per-part guess rather than from the
footprint.

The rule now gives 7.62 mm for that part (5.08 lead span + 1.27 each side), close to the
old figure but derived rather than invented, and a 1-hole LED comes out at 5.08 mm which is
exactly a 5 mm LED.

Getting this right needed the arithmetic, not the eye: my eye said "too big", the
arithmetic said "about right, for the wrong reason".

## Consequence worth knowing

A round body is sized by the **longer** side of its box, because a radial capacitor's can
covers both its leads. So a round part can exceed its courtyard across the short axis —
which is what a big capacitor does on a real board — and two round parts on neighbouring
holes can overlap visually. Rectangular parts cannot, because half-pitch stops their
outlines exactly halfway to the next hole.

Peter, 2026-08-30:
*"the DIP device pin 1 is generally top left, if yours it is top right."*
*"the board is 0.1" pitch, I think that footprints should be based on 0.1mm pitch for pins,
and with an 0.05" pitch for the silkscreet etc. device outlines should probably be drawn
0.05" around the pin extents."*

## 1. Pin 1 is on the wrong side

`dipPins` puts the second row at `dy: +width`. Rotation maps `(dx, dy)` to `(-dy, dx)`, so
at rot 90 — the orientation a DIL is actually used in on stripboard, straddling the strips
— the second column lands at **negative x**. Pin 1 therefore ends up on the **right**, with
numbering running down the right column and up the left. The convention is the opposite:
pin 1 top-left, down the left side, back up the right.

**Fix: the second row goes at `dy: -width`.** Then at rot 90 it maps to `+x`, pin 1 sits
top-left, pins 1..n run down the left column and n+1..2n run up the right.

Consequence, stated rather than buried: at rot 0 the package now extends **upward** from
its anchor rather than downward, because pin 1 is still the anchor. A DIL saved before this
change will appear shifted by its width. There is no way to tell an old placement from a
new one, so old boards are not migrated.

## 2. Outlines come from the pins, not from per-shape guesses

Every body shape currently carries its own hand-written size — `bodyLen`, `radius`,
`width`, `depth` — and they are wrong. A 2-hole electrolytic draws an 8.1 mm circle for a
part about 5 mm across, because the radius is computed as `radius * pitch * 0.5 + len / 2`
and so grows with the lead span.

Replaced with one rule, which is what Peter asked for:

> **A device outline is the extent of its pins, grown by 0.05 inch (1.27 mm) on every
> side.**

0.05 in is half the hole pitch, so an outline always stops halfway to the next hole — it
can never reach a neighbouring pin, and two parts on adjacent holes never overlap outlines.
That is why half-pitch is the right number and not a taste.

`footprintBox(placement, getPart)` returns `{ x, y, w, h }` in millimetres: the pin
bounding box inflated by `SILK_MARGIN_MM = 1.27`. Every shape is drawn inside it.

| shape | drawn as |
|---|---|
| `dip`, `tab`, `header`, `chip` | the box (chip keeps its true 1.6 × 0.8 mm) |
| `axial` | a rounded rect inset along the lead axis, the box's height |
| `can`, `blob` | a circle inscribed in the box |
| `d-package` | a D inscribed in the box |
| `hole` | unchanged — it is a ring round one hole |

A single-pin part gets a box 2.54 mm square, which is one hole's worth. That is the right
answer rather than a special case: its pin extent is a point, and a point grown by half a
pitch each way is a hole.

## Files

| file | change |
|---|---|
| `src/parts/library.js` | `dipPins` second row at `-width`; drop the stale size fields |
| `src/render/svg.js` | `footprintBox()`; every shape drawn from it |

## Explicitly NOT changed

- Pin pitch. Pins are on the 0.1 in grid already and stay there.
- The 0603's body, which is genuinely 1.6 × 0.8 mm from the datasheet and is drawn at that
  size inside its box rather than filling it. A chip really is smaller than its footprint.
- Migration of existing boards, as above.

## What a green run means

`tests/parts/test_footprint.mjs` reports `N/N checks passed`: at rot 90 a DIL's pin 1 is the
top-left pin, pins 1..n descend the left column and n+1..2n ascend the right; pin 1 and pin
2n stay opposite; every part's outline is exactly its pin extent plus 1.27 mm on each side;
a one-pin part's box is one hole; a 2-hole electrolytic's circle is under 6 mm across, not
8.1; and no two parts on adjacent holes have overlapping outlines.
