# SPEC — an SMT part is drawn as its land, not as its chip

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:     b86980bacbaee1b65278987990845d3bf5a382abe4c552f3551cbced2e2a30c7
  src/parts/library.js:  4c810f3d1f72507bfef647c620059bc533e8a4641627e7ecbc8f234f5b76e5c9

Peter, 2026-08-30: *"the way SMT parts are shown needs polising. I suggest a rectangle
footprint where the lenth of the SMT reaches across the trhough holes and the width is just a
little narrower than the copper strip. now it is barely visible."*

## What is wrong, and the reasoning that made it wrong

The 0603 is drawn at its true body size — 1.6 × 0.8 mm — and the code says why:

> Drawn at its real size in millimetres, not at a hole pitch: a 0603 is 1.6 × 0.8 mm and sits
> over the cut, nowhere near filling the 2.54 mm between the holes its pads are modelled at.

Every word of that is true and it is still the wrong drawing. **0.8 mm of translucent
silkscreen on a 2.0 mm copper strip is 40 % of the strip's width at 0.16 fill opacity, laid
over copper, holes and a cut.** It is accurate and invisible, and a part you cannot see is not
on the drawing.

Scale fidelity is not what this picture is for. Every other part here is drawn as a
**footprint**: the axial resistor's body is its pin span less a lead margin, the DIP is its
pin extent plus a courtyard. The 0603 was the one part drawn as an object instead of as a
land, and it is the smallest part on the board — the one that could least afford it.

## The land pattern

A rectangle derived from the pins, like every other body:

| | value | why |
|---|---|---|
| length | `pin span + HOLE_DIA_MM` = 3.54 mm | the ends land exactly on the **outer edges of both holes**: pins at ±1.27, holes 1.0 across, so the rectangle finishes at ±1.77. It reaches across the through holes, which is what says "this part bridges these two holes" |
| width | `TRACK_W_MM × 0.85` = 1.7 mm | a little narrower than the 2.0 mm strip, so the copper still shows either side and the part cannot be mistaken for the track |
| corners | `rx = 0.25 mm` | a land, not a chip |
| terminations | `HOLE_DIA_MM` = 1.0 mm at each end, filled | one over each hole, which is where the solder actually goes. They are what makes it read as a two-terminal part rather than a plain box |

Both dimensions come from constants that already describe the board — the hole and the track —
so the drawing follows if the geometry is ever corrected.

## `lenMm` and `widMm` go

Nothing will read them once the shape is derived, and data that nothing reads is the drift
this project has already paid for twice. The true chip size stays where it belongs: in a
comment, next to the reason the drawing is not that size.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | the `chip` case draws the land pattern from `len`, `HOLE_DIA_MM` and `TRACK_W_MM` |
| `src/parts/library.js` | `lenMm`/`widMm` come off both 0603 parts |

## Explicitly NOT changed

- The **model**: pins stay at two adjacent holes, which is what records the segments the part
  joins. The netlist is unaffected.
- `side: 'copper'`, `requiresBreak`, and the knife cut between the holes.
- How the top view ghosts a copper-side part.
- Every other body shape.

## What a green run means

`tests/parts/test_smt.mjs` reports `N/N checks passed`:

- the body reaches from one hole's outer edge to the other's — longer than the pin span, and
  not longer than the span plus a whole hole;
- it is narrower than the copper strip but more than half of it;
- it is still drawn only on the side the part is soldered to;
- two terminations are drawn, one at each end;
- the nets the part joins are unchanged by any of it.

**Two** existing checks are amended, not deleted, both of which asserted the 1.2–2.2 mm
length that was the old rule:

- `tests/parts/test_smt.mjs` — *the chip body is drawn at its true size, not a hole pitch*.
- `tests/parts/test_footprint.mjs` — *the 0603 keeps its real size rather than filling its
  box*. The half of that check which still holds — the body stays **inside** its courtyard,
  which is what that file is about — is kept and now asserted on both axes.

Plus, in a real browser, both themes and both views: the part is visible on the strip at a
glance.
