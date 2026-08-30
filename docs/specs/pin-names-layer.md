# SPEC — a pin says its own name

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:   595f5611552f7d2ea189d9b396eaf59bd8b63f0f21a782b0755c3044efcdcd3e
  public/app.js:       a02e4bd30f8872e65f650b56ff4a8b77a029760c2d5b68a0d533eff9c9d3e834
  public/index.html:   3220d74cd9726b711b468ae105fb0e1a4d5f5fb4572a0e982c7488f2420b0e1b
  public/style.css:    8da57530b9cee81be76e344d5247c8fc87c5140f9f23c02431cc6c1ada991e6c

## Two corrections made while building it

**The side comes from the pin ORDER, not the bounding box.** The first attempt asked which
axis of the pin field was shorter — and a XIAO is 15.24 mm along its rows and 15.24 mm between
them, so a square footprint made that question unanswerable and every name went the same way
at every rotation. Pins 1 and 2 are always adjacent along a row, so the vector between them
*is* the row and the outward direction is perpendicular to it. No case for "90" anywhere.

**0.42 of the pitch, not 0.5.** At 0.5 a row of three-character names touched — `GND` ended
where `3V3` began and the row read `GND3V3`. At 0.42 a three-character name is about 2.0 mm
against a 2.54 mm pitch.

Peter, 2026-08-30: *"comonnets (xiao etc) dont seem to have pin ID/Name/Numbers as a layer."*

## What is wrong

The names are already there and already correct. `placementFor` copies them onto the
placement, `resolvePins` resolves them, the DRC quotes them in its messages, and the run list
uses them. **Nothing draws them.**

So on a 14-pin XIAO you find `D4` by counting pads, which is the moment a board goes wrong —
and the wiring pass, the one where you most need to know which pad is which, is exactly when
you are looking at the board rather than at a datasheet.

## A layer of its own

Beside `netNames` and `labels`, for the same reason those are separate: a board covered in pin
names is unreadable while you are placing parts, and essential while you are wiring.

**Off by default.** Every other layer is on because it draws something the board has; this one
draws an annotation you ask for. Turning it on is the deliberate act of "now I am wiring".

## Where the name goes

Beside its pad, **not over it** — the pad is the thing you are aiming at, and a name on top of
it would be in the way of the very click it is helping you make.

- A pin on the **left** row of a two-row part takes its name to the left; a pin on the right
  row, to the right. Derived from the pad's position relative to the part's centre, so it
  follows rotation without a special case.
- A single-row part puts them **above** the row.
- Anchored `end` on the left and `start` on the right, so the names line up as a column
  against the package rather than drifting with their own lengths.

## It has to be readable, and small

Half the pitch — `PITCH_MM * 0.5` — which is smaller than a net name and about the size of a
part reference. A DIL's rows are 0.3 to 0.6 inch apart; there is 2.5 mm of clear board beside
a pad on a 0.3 in package and more on the others, and a four-character name at that size is
about 1.6 mm.

Drawn in the part's own silkscreen colour, like every other thing that belongs to a part, so a
green TMC2209's pin names are green and a board with three modules on it is readable by
colour.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | `DEFAULT_LAYERS.pinNames = false`; the pad pass draws the name beside each pad |
| `public/app.js` | the `Pin names` row in the Layers card |

## Explicitly NOT changed

- The pads themselves, their size, and pin 1 being square.
- `labels` and `netNames`, which stay independent.
- The names, which are already right and already carried on the placement.

## What a green run means

`tests/render/test_devices.mjs` reports `N/N checks passed`:

- with `pinNames` on, a placed XIAO draws **fourteen** pin names, and they are exactly its
  fourteen names;
- each is drawn beside its own pad, not on it — the name's anchor is at least a pad radius
  from the pad centre;
- a name to the LEFT of the part's centre is anchored `end`, one to the right `start`;
- **the layer is off by default**, so an existing board opens looking as it did;
- switching it off draws none, and does not affect `labels` or `netNames`;
- a generic part with numbered pins names them too — this is not a device-only feature.
