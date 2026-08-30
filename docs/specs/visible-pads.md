# SPEC — every pad shown, pin 1 square

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  418d04f2ada08083de493c02a674ba8400a9be2db91099a1e4053e46fb2d5065

## What the browser actually did

Red 7/11 → green 11/11, entry closed. 18 suites, 280 checks.

Six parts placed — DIP-14, resistor, diode, electrolytic, LED, 4-way header:

| | count |
|---|---|
| pads drawn | 26 |
| squares | **6** — one per part |
| circles | 20 |
| distinct stroke widths | one: `0.22` |

## Two things the checks caught that I had wrong

**"Pin 1" is not a pin named "1".** An LED's pins are `A` and `K`, and a diode's are `A` and
`K` too, so looking for `data-pin="1"` found nothing on either. It means the part's *first*
pin, whatever it is called — the anode of an LED is the square one. Pads now carry
`data-first`, and the check reads that.

**Rounding made the two shapes different sizes.** The square came out 1.727 mm across where
the circle was 1.728, because each was rounded from the radius independently. They are
supposed to read as the same size — that is the whole point of distinguishing them by shape
— so the radius is rounded once and both shapes are built from it.

Peter, 2026-08-30: *"components need their pads to be shown. currently only pin 1 is shown,
but all pads should be shown with the ring used there, but pin 1 should be a square marker
all other pins should be round."*

## Why only pin 1 appears to be shown

A pad **is** drawn for every pin. It is a circle of radius 0.66 mm with `fill="none"` and a
**0.12 mm** stroke in the mid-grey lead colour — about a fifth the weight of the silkscreen
line beside it, and low-contrast against both the copper and the board. It is there and it
is invisible.

Pin 1 reads only because the DIL body draws it a *second*, thicker ring at 0.22 mm in the
silkscreen colour. So the one pad that looks right is the one drawn by different code.

## The pads

Every pin gets one pad marker, in the silkscreen colour at the silkscreen stroke width, so
a pad is as legible as the outline around it.

| | shape | size |
|---|---|---|
| pin 1 | **square** | 1.72 mm across the flats |
| every other pin | circle | 0.86 mm radius |

0.86 mm is the radius; the hole it surrounds is 0.5 mm, so the pad reads as an annulus round
the hole rather than covering it. The square is drawn to the same 0.86 mm half-extent so
that a square and a round pad look the same size — which is the point of the distinction:
you are telling them apart by *shape*, not by weight.

Square pin 1 is the board convention, and it is the same convention whether the part is
polarised or not, so it applies to every part with pins — a resistor included. A part's
first pin is its pin 1.

## Consequences

- The DIL body's separate pin-1 ring is **removed**. Pin 1 is now marked the same way on
  every part, and two markers on one pin would be a double outline for no reason. The
  notch stays: it marks the *package*, not the pin.
- Pads stay `pointer-events="all"`. They are the move tool's target, and an unfilled shape
  is otherwise clickable only on its stroke.
- Pads keep `data-pin`, which is how the move tool knows which pin was grabbed.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | pad markers; drop the DIL's separate pin-1 ring |

## Explicitly NOT changed

- The holes themselves, which are the board's, not the part's.
- The underside view, where pads are drawn for both top- and copper-side parts because that
  is where you solder them.

## What a green run means

`tests/render/test_pads.mjs` reports `N/N checks passed`: a part draws exactly one pad per
pin; pin 1's pad is a `rect` and every other pin's is a `circle`; a square and a round pad
have the same half-extent; every pad carries `data-pin` and `pointer-events="all"`; the pad
stroke is the silkscreen weight, not the old 0.12 mm; a two-pin part still gets a square
pin 1; and no pin carries two markers.
