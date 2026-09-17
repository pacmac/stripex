# BUG — a part does not say which way its pins cross the strips

status: in progress
area: component-library

Peter, 2026-09-17: *"90% of lib items I add and out by 90/270 degrees. each lib item needs to
somehow identify it's pin -> strip orientation."* Then: *"Next, the rotation bug"*.

## What is wrong, measured

Every part in the catalogue defines its pins along a row, so at rot 0 pins 1 and 2 are on
**one strip**. Only the wire link says otherwise, through a typed `defaultRot: 90`. So a
resistor, a DIP, a TO-92, a header and a JST all place with every pin shorted to the next,
and have to be turned by hand. A test even pinned that: *"a part that declares nothing is
placed flat"*, with the resistor and the DIP at 0.

| pins 1 → 2 at rot 0 | parts |
|---|---|
| along a row (one strip) | every part with two or more electrical pins |

## The change

**Each part declares `pinsRun`,** which says how its pin row lies against the strips:

| `pinsRun` | means | parts |
|---|---|---|
| `across` | every pin on its own strip | wire-link, res-axial, diode, cap-ceramic, cap-electro, led, to92, to220, dip, header, jst-xh |
| `along` | the pins share a strip on purpose, which is then cut | sot23 |
| `either` | genuinely built both ways | smt-0603, smt-0603-cap |
| — | no pin row to orient | point-to-point (drawn, not placed), mount-hole (no electrical pin) |

**Why `either` exists, found while implementing.** The first cut declared the 0603s `along`,
and the new warning then fired six times on `555-blinker-v2`, a board with no other finding.
There the 0603s sit at 90°, bridging the gap between two adjacent strips with no cut. A
1.6 mm part reaches about half a millimetre onto each strip, which is a standard way to fit
one. `device`'s `rak4631-io` uses both: R2 at 90, R1 and R3 at 0 over a cut. So the honest
declaration is `either`: it never warns, and it still places at 0 as it always has. A
SOT-23 stays `along`, because across the strips it cannot be built (`pad-between-strips`).

**The default rotation is derived, never typed.** `defaultRotOf` returns the first of 0, 90,
180, 270 at which pins 1 and 2 satisfy the declaration: on different rows for `across`, the
same row for `along`. That gives 90 for `across`, which is the orientation that puts DIP pin
1 top-left, and 0 for `along`. It is computed from the pins, not from a table of angles, so
a part added later whose pins run down a column gets the right answer without anyone
knowing. The wire link's `defaultRot: 90` is removed: it becomes `pinsRun: 'across'`, and
one statement of the fact replaces two.

**A device inherits its base part's declaration and may override it.** `validateDevice`
accepts `pinsRun` of `across` or `along` and refuses anything else. `placementFor` copies it
onto the placement, the same as everything else a device brings, because a placement owes
the catalogue nothing. The Components screen shows it as a two-way choice under Package,
and its preview draws the device at the derived rotation instead of a hard-coded 90, which
was wrong for anything built on an SMT package.

**`addPart` uses it when no `rot` is given.** Today a missing `rot` means 0. An explicit
`rot` is always honoured.

**A warning, `pins-against-strips`, when a placement is turned against its declaration.**
A warning, not an error: laying a resistor along a strip over a cut is a legitimate
technique, and an error would make a working board read as broken. Peter was asked warning
or error and did not choose; warning was the recommendation and is one word to change.

## Nothing already placed moves

Rotation is stored on each placement. Boards open exactly as they were, and any placement
turned against its part's declaration now carries the warning, which is the point.

## Files

| file | change |
|---|---|
| `src/parts/library.js` | `pinsRun` on each part; `defaultRotOf` derived; `defaultRot` removed from the wire link |
| `src/parts/devices.js` | `pinsRun` validated and copied onto the placement |
| `src/model/ops.js` | `addPart` defaults `rot` from the declaration |
| `src/net/drc.js` | `pins-against-strips` |
| `public/app.js` | arming a device uses its override; the Components preview uses the derived rotation; the Package field |

## Explicitly NOT changed

- Stored placements. See above.
- `rotatePlacement`. Turning a part by hand is still a quarter turn.

## What a green run means

`tests/parts/test_pins_run.mjs`:

- every part with two or more electrical pins declares `pinsRun`, as one of the two values;
- at `defaultRotOf`, pins 1 and 2 of every `across` part are on different rows, and of
  every `along` part on the same row;
- the resistor, DIP, TO-92 and header default to 90, the 0603 and SOT-23 to 0, and nothing
  carries a typed `defaultRot`;
- a device inherits its base's declaration, may override it, `validateDevice` refuses a bad
  value, and `placementFor` copies it;
- `addPart` without `rot` places a resistor across the strips, and with `rot: 0` honours it;
- a resistor at 0 warns `pins-against-strips` with severity warning; at 90 it does not; an
  0603 at 90 warns; a device override is what the warning reads.

`tests/parts/test_default_rotation.mjs` loses the check that pinned the DIP and resistor at
0. It asserted the defect.
