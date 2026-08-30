# SPEC — components drawn as silkscreen, not as blobs

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  691d82f4ec577867c47680f48907c26321d5480c7e63591305ba2e7d734aa3fc

## What the browser actually did

Red 4/10 → green 10/10, entry closed. 13 suites, 206 checks.

Eight parts placed over cut and uncut strips — DIP-14, resistor, electrolytic, TO-220,
diode, LED, TO-92, pin header — in both themes. Copper and holes read clearly through every
body. Dark ink on the light board, light ink on the dark one.

Marks that came back as part of the outline rather than as filled glyphs: the DIL notch and
pin-1 ring, the diode cathode band, the electrolytic `+`, the TO-220 tab line. On a
translucent body the old light-on-dark versions would have been invisible.

## Found while looking, NOT fixed here

**The outlines are the wrong size.** A 2-hole electrolytic draws an 8.1 mm circle for a part
that is about 5 mm; the LED and TO-92 are inflated the same way. The `can`/`blob` radius is
computed as `radius * pitch * 0.5 + len / 2`, which grows with the lead span instead of
being the package's real diameter — the opposite of what the 0603 does, where the body is
stated in millimetres from the datasheet.

Outside this spec, which changed fill and stroke only, so it is filed as
`component-outlines-are-drawn-far-larger-than-the-real-parts` rather than fixed here. It is
worth doing: a silkscreen whose outline is half again too big is not much better than a
blob.

Peter, 2026-08-30: *"components need to be shown with a kind of slikscreen appearance where
the outlines of the devices are shown. currently thet are shown as greay ugly coloured
solid components, they should have opacity such that the strips / holes are still cisible
throught them."*

## What is wrong

Part bodies are drawn as opaque fills in a flat slate grey. Two consequences:

- you cannot see the copper or the holes under a part, which is exactly what you need to
  see when deciding whether a strip needs cutting
- a DIP-14 is a featureless dark rectangle, so the board reads as a set of grey slabs
  rather than as a circuit

## Silkscreen

A silkscreen is an **outline** printed on the board: a line drawing that says where the
part sits and which way round it goes, and nothing else. So:

| | before | after |
|---|---|---|
| fill | opaque slate `#3d4450` | the part colour at **`fill-opacity` 0.16** |
| outline | none | a stroke in the ink colour, `0.22 mm` |
| polarity marks | filled bars and glyphs | kept, drawn in the outline colour |

`0.22 mm` is not a taste: real silkscreen is printed at roughly 0.15–0.25 mm line width,
and at this board's scale a thinner line disappears while a thicker one starts to read as
a filled shape again.

The fill is not dropped entirely. A pure outline over a busy board makes it hard to tell
which holes are *under* a part — which matters, because a hole under a DIP body is one you
must not put a wire in. A wash at 0.16 says "something is over this" while leaving the
strip and hole plainly visible through it, which is what was asked for.

## Every shape gets an outline

`bodyFor()` currently emits `fill=` with no `stroke=` for `axial`, `can`/`blob`,
`d-package`, `tab`, `dip`, `header` and `chip`. All of them gain the stroke and the
translucent fill. `hole` (the mounting-hole ring) is already an outline and is unchanged.

Pin-1 marks, the diode band and the electrolytic `+` stay, in the outline colour rather
than as light-on-dark. On a translucent body, light-on-dark is invisible.

## Themes

Two new tokens per theme:

- `silk` — the outline. Dark ink on light, light ink on dark.
- `silkFill` — what the wash is made of.

The copper, holes and breaks are unchanged; only the parts stop hiding them.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | `silk`/`silkFill` tokens; every body shape outlined and washed |

## Explicitly NOT changed

- Pads and leads. A lead is a wire, not silkscreen, and it should stay solid enough to
  follow.
- The selection halo, which is already an outline and a wash.
- The underside view's rule about which bodies are drawn.

## What a green run means

`tests/render/test_silkscreen.mjs` reports `N/N checks passed`: every `part-body` element
carries a stroke; no `part-body` is drawn with an opaque fill; the wash is at most 0.3
opacity so the board shows through; the outline colour differs between light and dark; and
a part still draws exactly one body element per placement, so this is a restyle and not a
change of structure.

Plus, in a real browser, in both themes: a DIP, a resistor and an electrolytic over a cut
strip, with the copper and holes visible through all three.
