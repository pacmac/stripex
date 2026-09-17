# GAP — a SOT-23 package, and (later) a finding a board can accept

status: part 1 in progress; part 2 deferred by Peter
area: component-library

Two items raised by `device` on 2026-09-16 while it built the board `rak4631-io-pir`.

Peter, 2026-09-17: *"proceed with 1 first, will come back to 2"*.

## Part 1 — GAP there is no SOT-23, so a MOSFET is drawn as a TO-92

### What is wrong

`GET /api/parts` has no SMT semiconductor at all. The board needs an AO3401 P-channel
MOSFET in SOT-23, so it went down as a `to92`. The nets are right, but the outline on
screen is not the part Peter is holding.

`device` warned against the easy fix, and it is right: **three pads in a row called
`sot23` would be a second lie, and a worse one, because it would look right.** A SOT-23
has two pins on one side and one opposite (a 2+1 straddle), at 0.95 mm pitch, and none of
its pads fall on the 0.1 in grid.

### The decision: a native part, modelled the way the 0603 already is

This repo already has a part whose pads miss the hole grid. `smt-0603` is mounted on the
copper side and recorded **at the holes whose strip segments it joins**. Connectivity
comes from segments, not hole centres, so the same model holds for a SOT-23. An adapter
board part would be a fair separate addition, but it does not replace a part for people
who solder the chip straight onto the strips.

On stripboard a SOT-23 sits on the copper side across two adjacent strips:

- **pins 1 and 2 on one strip.** They are 1.9 mm apart, so the strip is knife-cut
  between them, the same as an 0603. The cut is derived: `requiresBreak: true`,
  `breakType: 'knife'`.
- **pin 3 on the next strip, centred between pins 1 and 2.** So it sits over the GAP
  between two holes, not on a hole.

### Pin 3 is half a hole off the grid, and that needs two things

**1. A drawing offset that is not a connectivity offset.** Pin 3 stays at an integer
column for connectivity. The only thing that matters there is which strip segment it
touches, and nothing can be between two holes of one uncut strip. It carries
`ox: 0.5`, an offset along the strip that only the drawing uses. `resolvePins` rotates
it with the part and returns it as `drawCol` / `drawRow`, so every drawing of the pad
stays in step with rotation without knowing SOT-23s exist.

**2. Two checks, because an off-grid pad can land on something a gridded one cannot:**

| code | when | why it is an error |
|---|---|---|
| `pad-over-cut` | a knife cut is at the gap an off-grid pad straddles | the pad sits across the cut, so whichever side it joins is chance |
| `pad-between-strips` | the offset lands ACROSS the strips (rot 90 or 270) | pins 1 and 2 are then on different strips 1.9 mm apart, and pin 3 is on the gap between two strips. Nothing about that can be built. |

### Which way round, and why it is not arbitrary

A SOT-23 is chiral: a mirror image cannot be rotated into the real part. Its standard
outline, marking side up, reads **pin 1 bottom-left, pin 2 bottom-right, pin 3 top
centre**. On the copper side the marking faces **away from the board**, so the view that
must read like that is the **underside view**, and the underside view mirrors x.

Pins at rot 0: `1 (0,0)`, `2 (1,0)`, `3 (0,+1, ox 0.5)`. In the underside view that is
the standard outline turned 180 degrees: same handedness, so it can be rotated to match.
This is checked by the sign of the cross product of pin 1 → 2 → 3 in each view.

### Pinout is per device, not per package

G/S/D is not the package's business. On an AO3401 it is 1 = G, 2 = S, 3 = D, but another
SOT-23 part numbers them differently. The package names its pins 1, 2 and 3. A device
entry (`PUT /api/devices/:id`) supplies the names, the same as the TMC2209.

That has a consequence `device` has already been told. On an AO3401, gate and source are
pins 1 and 2 on the same side, so the gate-to-source tie on stripboard is **leaving out
the cut between pins 1 and 2**. The board then trips `missing-required-break`, and that
is what Part 2 has to be able to accept.

### What it is drawn as

The LAND, not the chip, for the reason `smt-land-pattern.md` gives for the 0603. It is a
rectangle spanning both strips and both columns, with a darker termination over each of
the three pads, so it reads as a three-terminal part at a glance. Copper-side pads are
square (`extents-and-smt-lands.md`).

### Files

| file | change |
|---|---|
| `src/parts/library.js` | the `sot23` part |
| `src/model/rotate.js` | `resolvePins` returns `drawCol` / `drawRow` from a rotated `ox` |
| `src/render/svg.js` | pads and extents use the draw position; a `sot23` body shape |
| `src/net/drc.js` | `pad-over-cut`, `pad-between-strips` |

### Explicitly NOT changed

- `src/net/derive.js`, `src/net/segments.js`: connectivity is untouched by construction.
  Pin 3 is at an integer hole.
- The board `rak4631-io-pir`. That board belongs to `device`, which re-places Q1 itself.
- Any AO3401 device entry. That is data, and `device` owns the claim about its pinout.

### What a green run means

`tests/parts/test_sot23.mjs`:

- `sot23` is in the catalogue: copper side, requires a knife cut, three pins.
- at every rotation, pin 3 is drawn half a hole along the strip from its connectivity
  hole, centred between pins 1 and 2 at rot 0 and 180;
- the derived cuts are exactly one knife cut, between pins 1 and 2;
- the underside view has the handedness of the standard outline;
- a knife cut under pin 3 raises `pad-over-cut`; rot 90 raises `pad-between-strips`; a
  correctly placed and cut SOT-23 raises neither, and no `short-across-part`;
- the rendered pads for pin 3 are at the drawn position, not the hole.

## Part 2 — deferred

A board saying *"this finding is intended, because…"* about one finding on one placement.
The proposed shape is on the channel `device--stripex`, item
[short-across-part-cannot-express-an-intended-tie]. It will not be built until Peter
comes back to it.
