# SPEC — Escape returns to Select; colour on wires, parts and cut strips

status: implemented, both entries CLOSED
area: editor-ui
source_hash:
  src/render/colours.js:  a36ae175eed8c95add3875f98c4f6ce3317b9f7712969cc66760a97ae6a84b6b
  src/render/svg.js:      3512669ff9cdb64e2b8fd0ddd801f206b3d9b0013f1dfdfb0afefced8361c208
  src/model/edit.js:      7f635c18ee0013bfb270c329df795f505f02aa733dde092f66e259d77751b36d
  public/app.js:          97e083fceece6f70027d47490af91fdb8f1e34b2f2c68044d5aac76b35398f41

## What the browser actually did

Red 5/20 → green 20/20, both entries closed. 19 suites, 300 checks.

**Escape.** Armed the Wire tool, clicked one hole so a wire was half-drawn, pressed Escape:
the armed tool became `select` and no wire was created.

**The code.** Ten wires drawn, read off the page:

| | W1 | W2 | W3 | W4 | W5 | W6 | W7 | W8 | W9 | W10 |
|---|---|---|---|---|---|---|---|---|---|---|
| | brown | red | orange | yellow | green | blue | violet | grey | white | **black** |
| | `7b4a12` | `c92a2a` | `e8590c` | `e6c02a` | `2f9e44` | `1971c2` | `7048e8` | `909296` | `f1f3f5` | `1c1c1c` |

W10 wrapping to black is the point of using the last digit: thirty wires still read off a
ten-way drawer. Ten casings for ten wires, and on the tan board **W9 white and W10 black are
both plainly legible** — which is what the casing exists for, since the code contains both
extremes and the palette cannot avoid them.

**Cut strips.** Row 1 cut once draws `#d9a878` and `#c39262` — a 22-per-channel step.
Uncut rows draw a single fill, so an uncut board is unchanged.

Peter, 2026-08-30: *"when you use the esc key, the mode should switch to [select]. and
components are going to need colours, should be configurable, one of the most critical ones
is wires, they should default to the standard component colour codes 0-9, but can be
changed. when a track has a break in it, the contrast or colour or opacity of each broken
segment should be slightly different."*

Three changes, one theme: you should be able to tell things apart by looking.

---

## 1. Escape returns to Select

`Esc` currently cancels the pending wire, the move handle and the selection, and leaves you
in whatever tool was armed. So cancelling a half-drawn wire leaves the next click starting
another one.

It now also arms **Select**. Escape means "stop what I am doing", and the tool is part of
what you are doing.

Cancelling is still one press: it clears the wire start, the move handle and the selection,
*and* returns to Select, rather than needing a press and then a click on the toolbar.

---

## 2. Wire colours, from the component colour code

A wire's colour comes from **its own number** through the standard 0–9 code, which is what
you would reach for in a drawer of hook-up wire:

| n | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| | black | brown | red | orange | yellow | green | blue | violet | grey | white |

`W1` is brown, `W2` red, … `W9` white, `W10` black again — the digit is `n mod 10`, so the
last digit of the ref names the colour and a run list of thirty wires still reads off a
ten-way drawer.

`wire.colour` overrides it with any CSS colour. Absent means the code applies, so an old
project gets colours without being migrated.

> **Black and white wires must survive both themes.** A black wire on the dark board and a
> white one on the light board would each vanish. Every wire is therefore drawn over a
> **casing**: a slightly wider stroke in the theme's contrasting ink at low opacity. That
> makes the colour readable whatever it is, instead of restricting the palette to colours
> that happen to work on both grounds.

## 3. Component silkscreen colour

Peter: *"I think that components should have a silk screen colour?"* — yes, and that is
precisely what a component's colour is. A part's outline and wash **are** its silkscreen, so
the field is called `silk` rather than `colour`: it says what it paints instead of leaving
the reader to wonder whether it also affects the pads or the leads. It does not; pads stay
the theme's silk colour so a part's chosen colour cannot make its own pads unreadable.

Resolution order, first hit wins:

1. `placement.silk` — this one part
2. `part.silk` — every part of this type, from the library
3. the theme's silk colour, exactly as now

Both this and the wire colour are editable in the Focus panel, as a colour input beside the
other fields.

---

## 4. A cut strip's segments must look different

A break is a 0.54 mm mark. On a busy board it is easy to miss, and then two segments of one
row read as one strip — which is the single most expensive misreading this tool can cause,
because it is the difference between a working circuit and a short.

So **adjacent segments of the same row are drawn in alternating shades**: segment 0 in the
copper colour, segment 1 slightly lighter, segment 2 back to base, and so on. An uncut row
is one segment and looks exactly as it does now, so an uncut board is unchanged.

The difference is deliberately slight — it is a hint that something changed along the row,
not a stripe pattern competing with the parts.

---

## Files

| file | change |
|---|---|
| `src/render/colours.js` | **new** — the 0–9 code, `wireColour()`, `segmentShade()` |
| `src/render/svg.js` | wire casing and colour; part colour; alternating segment shades |
| `public/app.js` | `Esc` arms Select; colour inputs in the Focus panel |
| `src/model/edit.js` | `colour` as an editable field |

## Explicitly NOT changed

- The net highlight colour, which must stay distinct from every wire colour or highlighting
  would be indistinguishable from a yellow wire.
- DRC marker colours, which mean severity and are not decoration.

## What a green run means

`tests/render/test_colours.mjs` reports `N/N checks passed`: `W1` is brown and `W9` white;
`W10` wraps to black; a `colour` on the wire wins; every wire is drawn with a casing wider
than its own stroke; a part's `colour` reaches its body; an uncut row draws one shade;
a row cut once draws two different shades; the shades differ but not by much; and
`Esc` maps to the Select tool.
