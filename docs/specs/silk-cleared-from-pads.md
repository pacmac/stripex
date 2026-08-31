# SPEC — silkscreen is clipped back from pads

status: draft
area: editor-ui
source_hash: (set in Phase 4)

Peter, 2026-08-31:

> *"is it possible for the silk screen outline not to cut through the device's own pads as it
> is confusing."* … *"break the outline where it crosses a pad - yes."*

## Measured

Distance from each pad centre to the nearest edge of its own body outline:

| | |
|---|---|
| JST 3-way **right angle** | **0.00 mm** on all three pads — the line bisects every one |
| JST 3-way straight | 2.35 mm — clear |

Pad radius is 0.86 mm, so on the right-angle part the outline runs straight through the middle
of each pad. It is not a stray case either: it followed directly from putting the pins in line
with the shroud's edge, which is where they really are. **Any part whose body edge coincides
with its pin row will do this**, and correcting a footprint to the truth makes it more likely,
not less.

## The change

**This is what a real board does.** A fabricator clips silkscreen back from every pad, because
ink on a pad spoils the solder joint — the drawing convention Peter is asking for is the
manufacturing rule.

The body is drawn inside a wrapper carrying an SVG `mask`, and the mask has a hole at each of
that placement's pads, one clearance wider than the pad. Everything the body draws — outline,
wash, polarity mark, latch — is cleared back from the pads together, because silk does not get
printed over a pad whatever shape it is part of.

A mask rather than arithmetic: the bodies are rects, circles, rotated groups and paths, and
computing where each shape's edge crosses each pad would be a second geometry engine that has
to agree with the first. The mask asks the renderer to do it.

- **One mask per placement**, keyed on its ref, so two parts cannot share holes.
- **The pads themselves are not masked** — they are drawn outside the wrapper, and they are
  the thing being made legible.
- A part with no pads, or no body, is unchanged.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | the components pass wraps each body in a masked group |

## Explicitly NOT changed

- The body shapes, their dimensions, or the JST constants just measured.
- The pin-1 square, the pad colours, and hit-testing: `data-kind="pad"` elements keep their
  attributes and stay clickable.
- The DRC, the rules, and anything about connectivity. This is a drawing change only.

## What a green run means

`tests/render/test_silk_clearance.mjs` reports `N/N`:

- a right-angle JST — the part where the outline bisected every pad — draws its body inside a
  masked group;
- the mask has **one hole per pad, at the pad's own centre**, and each hole is larger than the
  pad it clears;
- **the mask id is unique per placement**, so two parts on one board do not share it;
- the pads are still drawn, still carry `data-pin` and `data-kind="pad"`, and are NOT inside
  the masked wrapper;
- a part with no body of its own renders as before;
- and every part in the library still renders without error at every rotation.
