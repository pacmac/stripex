# BUG — a can body is drawn as wide as its leads are spread

status: in progress
area: editor-ui

Registered as `a-can-body-is-drawn-as-wide-as-its-leads-are-spread`: a can's radius is
`Math.max(box.w, box.h) / 2`, half its lead span, and the `body.radius` each can part
declares is never read. An electrolytic placed with its leads 13 holes apart is drawn as a
33 mm disc over a third of the board. *"No real capacitor grows because you spread its
leads."*

## The change

A can's radius is **the smaller of** half its lead box, as now, and **the radius the library
declares**, in holes: `body.radius × pitch`. So:

- at the ordinary lead pitch it is drawn as it was, up to the declared size. The LED is
  0.9 holes (a 4.6 mm can, a 5 mm LED), the electrolytic 1.2 holes;
- with the leads spread wider, the can stays that size, centred, and the leads are drawn out
  to their holes as they already are.

**One function** gives the radius to both the drawing and the drawing's extent, so the window
cannot be sized for a 33 mm disc that is no longer drawn.

A round body that declares no radius (the ceramic disc, `shape: 'blob'`) is unchanged.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | `roundRadiusMm(part, box)`, used by the body and by `bodyCornersMm` |

## What a green run means

`tests/render/test_can_size.mjs`:

- an electrolytic at a 2-hole and at a 13-hole lead span is drawn with the same radius, the
  declared 1.2 holes;
- an LED is drawn at 0.9 holes;
- the drawing's extent for the 13-hole capacitor is no wider than its leads plus a margin,
  not a 33 mm disc.
