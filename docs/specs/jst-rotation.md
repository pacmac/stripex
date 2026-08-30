# SPEC — a connector's shroud follows its pins

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  ae187f18ecd8b534ce7b5216bc4a49bd7c1c6a95e57ebfe2189311b691c8e9f6

Peter, 2026-08-30: *"when I rotate a JST it looses it's footprint."*

## What happens

Measured in Chromium, a 4-way JST at rot 0 and the same part at rot 90:

| ref | rot | body drawn |
|---|---|---|
| J1 | 0 | 172 × 49 px — the whole connector |
| J2 | **90** | **43 × 49 px** — a box around pin 1, with the other three pins outside it |
| J3 | 0 | 172 × 81 px |
| J4 | **90** | **43 × 81 px** |

The shroud collapses onto the first pin and the rest of the connector is bare pads.

## Why

The `jst` case I wrote yesterday builds an **axis-aligned** rectangle:

```js
const w = box.w;                    // the footprint's WIDTH, in board axes
const y0 = right ? a.y - PITCH_MM * 0.45 : a.y - d / 2;
```

`box` is the footprint's bounding box in board coordinates. At rot 0 a one-row connector is
wide and shallow, so `box.w` is the connector's length and this works. At rot 90 the pins run
down the board: `box.w` is now **one pin wide**, and the rectangle drawn from it covers one
pin. The depth `d` is a constant along the wrong axis as well.

Every other body in this renderer already handles rotation, in one of two ways, and the JST
does neither:

- `dip`, `header`, `tab` use **both** `box.w` and `box.h`, so they follow the box whichever
  way it is oriented;
- `axial`, `chip`, `d-package` emit a **rotated group** — `translate(mid) rotate(angle)` —
  and lay themselves out along the pin axis in local coordinates.

A JST cannot use the first: its body is not the footprint. It is deeper than the pin row on
one side and, for a right-angle, offset entirely to one side — that asymmetry is the whole
point of drawing it, and a bounding box has no side.

So it takes the second, which is what the chip beside it already does.

## The fix

Lay the shroud out along the pin axis in local coordinates, inside
`translate(midpoint) rotate(angle)` where `angle` is the direction of the pin row — the same
`angle` the `axial` and `chip` cases already compute from the first and last pin.

Local layout, x along the row and y across it:

| | value |
|---|---|
| length | `len + PITCH_MM` — the pin span plus half a pitch of shroud past each end pin |
| straight depth | `PITCH_MM * 1.15`, centred on the row |
| right-angle depth | `PITCH_MM * 1.9`, offset to one side so the body lies over the board |
| ramp | as now: a tab proud of the mating face on a straight one, a band on the far edge of a right-angle |

The appearance at rot 0 is unchanged — that is the drawing Peter accepted — and it now
follows the part around.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | the `jst` case emits a rotated group and works in local coordinates |

## Explicitly NOT changed

- The look at rot 0: the shroud, the ramp, and the difference between straight and
  right-angle.
- Every other body shape.
- The pins themselves, which already rotate correctly — this is a drawing fault, not a
  geometry one.

## What a green run means

`tests/parts/test_devices.mjs` reports `N/N checks passed`, with a **geometric** check rather
than a structural one: the emitted rectangle's four corners are transformed into board
coordinates by its group's own transform, and

- **every pin of the connector falls inside its own shroud**, at rot 0, 90, 180 and 270, for
  both bodies and for 2-way and 8-way — the failure being fixed;
- the shroud is longer along the pin axis than across it, at every rotation, so it cannot have
  collapsed;
- straight and right-angle are still drawn differently at every rotation;
- and the ramp is still drawn.

A structural check — "is there a rotate() in the output" — would pass on a rotated group of
the wrong size. It has to be the geometry.

Plus, in a real browser: both bodies at all four rotations.
