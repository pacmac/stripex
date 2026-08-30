# SPEC — a pen pad is visible whatever colour the wire is

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  ed5ec9fbe5c31a1a9b2932bffc09521afcdd5c83d2c897d72efde0a4f513fac4

## It was not the only reason he could not see them

Peter said "still no point to points" after this was diagnosed, which was right: the white
pads were the *second* fault. The first was that his browser never loaded the board at all —
the editor treated the blank board it starts with as a draft worth protecting, so a browser
with nothing in storage refused to open the board it was bookmarked to and drew an empty grid
over a file with five wires in it. That is
`a-clean-browser-refuses-to-open-a-board`, fixed alongside.

Two faults with one symptom. Fixing the visible one and stopping would have left him still
unable to see anything, and me confident I had fixed it.

Peter, 2026-08-30: *"well I cannot see any point to points you have added."*

## What is wrong

Two of the five wires I added are **9 holes long**, and 9 in the component colour code is
**white**. Measured on his board:

| wire | length | colour |
|---|---|---|
| A | 9 | `#f1f3f5` white |
| B | 7 | `#7048e8` violet |
| C | 15 | `#2f9e44` green |
| D | 6 | `#1971c2` blue |
| E | 9 | `#f1f3f5` white |

A pad is drawn filled in that colour with an outline of `c.wireCasing`, which on the light
theme is `#fbf7ee`. So a white pad gets a **near-white outline** on a `#e8dcc0` substrate over
`#d9a878` copper. Three tones of off-white. It is drawn, it is in the DOM, and it cannot be
seen.

The casing's own comment explains how it got this way:

> Light ground, so the casing is a light halo: it is a white wire that would otherwise vanish
> here.

That reasoning is for the LINE — a dark line on a light ground wants a light halo behind it.
Applied to the pad's outline it is exactly backwards: the thing that needs rescuing is the
white pad, and a light halo is what hides it.

## The fix

The outline is `readableOn(fill)` — the helper already used for net names and pin names, which
picks near-black or near-white by relative luminance. A white pad gets a dark ring, a black
pad a light one, and every pad in between whichever contrasts.

**The fill does not change.** The length colour is load-bearing: it says which pre-cut wire to
take from the drawer, and that is the whole reason wires are coloured by length.

`wireCasing` keeps its job on the selected wire's LINE, where the halo reasoning is correct
and where it is drawn behind a stroke rather than around a disc.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | the wire pad's stroke |

## Explicitly NOT changed

- `wireColour` and the 0–9 code.
- The pad radius and the ID inside it.
- The casing on a selected wire's line.
- Component pads, which are outlines in the part's silk colour and have no fill to contrast
  against.

## What a green run means

`tests/render/test_point_to_point.mjs` reports `N/N checks passed`:

- **a white wire's pad is outlined in something dark** — the case that was invisible;
- a black wire's pad is outlined in something light;
- every pad's outline differs from its own fill by a real luminance margin, checked across all
  ten code colours rather than the two extremes;
- the fill is still the length colour, unchanged;
- and the ID inside the pad stays readable, which it already was.
