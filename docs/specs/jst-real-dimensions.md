# SPEC — the JST body is the size JST says it is

status: implemented, entry CLOSED
area: component-library
source_hash:
  src/render/svg.js:  708aa59b620b9498b226e25e7713d2a4915a95ba153a2bb61c01faa47191939a

Peter, 2026-08-31: *"the footprint for JST XH is wrong."*

He is right, and it is wrong by a constant rather than by a proportion — which is why the
8-way looked nearly right and the 2-way looked badly wrong.

## Measured

The JST XH drawing dimensions the housing as `A = 2.5(n−1)` (the pin span) and `B = A + 4.9`
(the housing length). Cross-checked against the KiCad footprint library's fab outlines for the
2, 3, 5 and 8-way parts, vertical and horizontal:

| | real | stripex draws |
|---|---|---|
| length | `2.5n + 2.4` mm — **exactly 2.5 mm per way** | `n × 2.54` — one hole short at every size |
| past each end pin | **2.45 mm** (0.96 of a hole) | 1.27 mm (half a hole) |
| depth, vertical | **5.75 mm**, asymmetric: 2.35 back / 3.4 front | 2.92 mm, centred |
| depth, right angle | **11.5 mm**: 2.3 back / **9.2 over the board** | 4.83 mm: 1.14 / 3.69 |

**Depth does not scale with way count at all.** It is the same number for a 2-way and an
8-way. Only the length grows.

**A FIRST SOURCE WAS WRONG AND A SECOND CAUGHT IT.** A datasheet summary gave the length as
`2.5n + 3.6`, which would make a 3-way 11.1 mm. The KiCad outline says 9.9 mm and JST's own
`A + 4.9` confirms it. Trusting one source would have shipped an 11% error.

## Why the right angle is the one that matters

A real S*B-XH-A lies over the board extending **9.2 mm — about 3.6 strips — past its pin
row.** stripex shows 1.45. So the drawing says those rows are free while the connector is
physically sitting on them, and a layout will put parts underneath it.

That is the same class of fault as a capacitor drawn wider than its leads, pointed the other
way: this one **under**-draws, and hides a collision instead of inventing one.

## The change

The body was built from invented proportions — half a pitch of overhang, depths chosen to
"read as a shroud". They become named constants taken from the drawing:

```js
const JST_END_MM   = 2.45;  // housing past each end pin — (B − A) / 2
const JST_BACK_MM  = 2.35;  // behind the pin row, vertical
const JST_FRONT_MM = 3.40;  // in front of it, vertical — the mating face
const JST_RA_BACK_MM  = 2.30;  // behind the pin row, right angle
const JST_RA_FRONT_MM = 9.20;  // over the board, right angle
```

**Length becomes the pin span plus a constant**, so it scales for every way count without
anything else being said. The 0.04 mm per way that 2.54 pitch adds over JST's 2.5 is left
alone: the pins really are on the board's pitch, and the library header already records that
choice.

The vertical body stops being centred on the pin row, because the real one is not.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | the `jst` body case, drawn from the constants above |

## Explicitly NOT changed

- The pins, the pitch, and the 2.5-versus-2.54 decision already recorded in `devices.js`.
- Where the dimensions live. They stay in the renderer for now; moving body geometry into the
  catalogue so a new connector is a data entry is a **separate** change and is registered
  rather than smuggled in here.
- The ramp, other than following the body it sits on.

## What a green run means

`tests/render/test_jst_dimensions.mjs` reports `N/N`:

- for 2, 3, 5 and 8 ways, the drawn body is **the pin span plus 4.9 mm**, so it scales at
  2.5 mm per way;
- an n-way body is about **n + 1 holes** long, never n;
- the vertical body is 5.75 mm deep and the right-angle 11.5 mm, **at every way count** —
  depth does not scale;
- the right-angle body extends **9.2 mm to one side of the pin row**, which is the number a
  layout has to respect;
- the vertical body is asymmetric about the pin row, not centred;
- and both are still drawn in a rotated group, so a connector at rot 90 keeps its shape.

## What the corrected drawing then showed

A right-angle connector placed near the left edge now visibly hangs **off the board**, because
it really does. That is the drawing doing its job: at the old size it fitted, and the board
said a placement was fine that was not.

It also makes `nothing-catches-two-part-bodies-in-the-same-column` worth more than it was. A
right-angle JST now covers three and a half strips beyond its pins, so the odds of a body
collision that nothing reports have gone up, not down.
