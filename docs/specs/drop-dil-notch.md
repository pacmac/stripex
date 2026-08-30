# SPEC — no notch on a DIL body

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  1bc1bccfb7ce092836ee6849f6b6369aea7c37bdc6f9c62b90ece925de5409e3

## What the browser actually did

Red 11/12 → green 12/12, entry closed. 21 suites, 325 checks.

| | |
|---|---|
| `<path>` elements in the DIL group | **0** |
| body still drawn | yes |
| square pin-1 pad | 1 |
| TO-220 tab line still drawn | yes |
| diode cathode band still drawn | yes |

The last two were checked on purpose. Those marks identify a *feature of the package* — which
face the tab is on, which end the cathode is — and are not duplicated by anything the pads
say, so they stay. The notch went because pin 1 is now marked the same way on every part.

Peter, 2026-08-30: *"remove the little semi circle from a dip component that indicates the
top."*

## What goes

The `dip` body draws a half-round arc on the pin-1 end, the notch a real DIL package has
moulded into it. It is removed.

It was already redundant. When the notch was added, pin 1 was marked by an extra ring drawn
by the DIL body itself. That ring is gone — pin 1 is now the **square pad**, on every part
alike — so the notch became a second way of saying the same thing, on one part only.

The body is a plain rounded rectangle. Which end is pin 1 is read off the square pad, which
is the convention and works on every package rather than only this one.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | drop the notch path from the `dip` shape |

## Explicitly NOT changed

- The square pin-1 pad, which is what now carries the orientation.
- Any other body shape. The TO-220's tab line and the diode's cathode band stay: those
  identify a *feature* of the package, not a pin the pads already mark.

## What a green run means

`tests/render/test_pads.mjs` gains a check: a DIL's group contains no `<path>` element, so
the arc is gone and nothing else grew one; the body is still drawn; and pin 1 is still
identifiable, by its square pad.
