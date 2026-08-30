# SPEC — wire colour comes from length; a link is wire and silkscreen both

status: implemented, both entries CLOSED
area: editor-ui, component-library, board-model
source_hash:
  src/render/colours.js:  42fad8c6badbfc2db1c186777d0d4eb0524639842a7007b10661b98d563dbc4a
  src/render/svg.js:      774da5bd44596b44cbc7fa32e8258bc991eee646a88edda6adf9bb5c77e2cc0c
  src/model/breaks.js:    a001f90710094480bba3888f7d79fb33544eddb8176fac21c212bc3676f70baf
  src/model/edit.js:      7c13c6f0e7e98f0233949313273aa36cf08f268cfae0f1bfe542a38e38fcc4ed
  public/app.js:          86ec61d70df7fa898754eaf28aabc80c652ff020764b426e4e27da514a8b5a41
  public/style.css:       ebbf927c9aff382c14ab5cdd7023d8d54f579ffdeb32874b3d43d48d72603619

## 5. A DIL's automatic cuts can be switched off

Peter, mid-task: *"with DIP components, the spot face track breaks need to be switchable. I
may turn them off and add my own track breaks under the component."*

`placement.autoBreak: false` stops that placement deriving any cuts. Absent means true.

> The switch governs what the part **contributes**, not what it **needs**. Turning the cuts
> off does not make a shorted chip un-shorted — it means you intend to cut the strips
> yourself, and until you do the tool must still say the package is shorted pin to pin.

So `requiredBreaks` honours the switch and a new `neededBreaks` ignores it; the DRC asks the
second. The first implementation had both going through one function, and switching the
cuts off silently switched the errors off with them — a chip reported as fine while every
opposite pin pair was shorted. Caught by the check, not by the eye.

Hand cuts elsewhere are honoured rather than overruled: cutting one gap to the left of where
the tool would have drilled clears the errors just the same.

## What the browser actually did

Red 3/13 and 5/11 → green 13/13 and 11/11, both entries closed. 21 suites, 324 checks.

Six wire links of spans 1 to 6:

| span | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| | brown | red | orange | yellow | green | blue |

and every one of their pads `#26303d` — the silk colour — so a link reads as a coloured wire
between ordinary pads, which is what was asked for.

A DIP-14 with its cuts on: 7 cuts, 0 errors. Unchecked: **0 cuts, 7 errors**, the first
reading *"U1 needs the strip in row 3 cut between holes 15 and 16"*.

The picker shows 17 cells: 16 colours and a `×` for Default.

## A correction to the previous spec

`colour-and-escape.md` said the silkscreen colour "never touches the pads, so a pale part on
a pale board cannot make its own pads unreadable", and had a check asserting it. That was my
invention rather than the model. A pad is a **silkscreen marking**, not copper, so a part's
silkscreen colour must paint it — which is exactly what Peter meant by *"the pads for a wire
link would be treated as the silk screen"*. The check was rewritten to assert the opposite,
and legibility is the user's choice, one they can undo.

Peter, 2026-08-30: *"does not work. wires are a special case theny need wire colour, the
pads for a wire link would be treated as the silk screen. so any component has a silk screen
colour, wire links have wire colour as well. and now all are set to black and not the colour
code based on length. and the colour picker needs to be simpler a 16 colour picker is more
than enough."*

## What is wrong, measured

| | found |
|---|---|
| a `wire-link` part, any span | drawn `#26303d` — the theme silk colour, near black |
| pen wire `W1`, 3 holes long | brown — the colour for **1**, from its ref |
| pen wire `W2`, 8 holes long | red — the colour for **2**, from its ref |

Two faults. Links have no wire colour at all, and the code is keyed on the wrong thing.

## 1. The code is keyed on LENGTH

I read "the standard component colour codes 0-9" as the wire's number. It is the wire's
**length**, which is the useful thing: colour tells you which pre-cut wire to take out of
the drawer, so a 3-hole wire is orange in every project and on every board.

```
colourForLength(holes) -> COLOUR_CODE[holes % 10]
```

| holes | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| | brown | red | orange | yellow | green | blue | violet | grey | white | black |

Length in holes is:

- **wire link** — its `span`, which is what it is made from.
- **pen wire** — `round(hypot(Δcol, Δrow))`, the straight-line distance in holes, because a
  pen wire runs diagonally and the wire you cut for it is that long. A 3-4-5 diagonal is a
  5-hole wire and gets green, the same green as a straight 5-hole one, which is right:
  they are the same piece of wire.

Wrapping at ten is unchanged and still deliberate — an 11-hole wire is brown like a 1-hole
one, and the drawer has ten compartments.

## 2. A wire link is wire AND silkscreen

Peter: *"the pads for a wire link would be treated as the silk screen"*.

Every component has a silkscreen colour. A wire link has that **and** a wire colour, and
they paint different things:

| | painted with |
|---|---|
| the link's body — the wire itself | **wire colour**, from its span |
| the link's pads | **silkscreen colour**, like every other part |

So a link reads as a coloured wire between two ordinary pads. Overriding its `silk` recolours
the pads and leaves the wire alone; overriding its `colour` recolours the wire and leaves the
pads alone. That separation is the point of the request.

`kind: 'link'` is what marks a part as wire-coloured, so any future zero-ohm part gets it
without a second list to keep in step.

## 3. A 16-swatch picker

The native `<input type="color">` opens an operating-system colour dialog with a spectrum,
an eyedropper and a hex field, for a choice between at most a handful of sane values on a
board. Replaced with 16 swatches: the ten code colours, six more for parts, and a
**Default** that clears the override so the value goes back to being derived.

Clearing matters more than the extra six. Without it, once you touch a colour there is no
way back to "whatever the length says".

## Files

| file | change |
|---|---|
| `src/render/colours.js` | `colourForLength()`, `wireLengthHoles()`, `PALETTE_16` |
| `src/render/svg.js` | links drawn in wire colour, pads in silk |
| `public/app.js` | swatch picker in the Focus panel |
| `public/style.css` | the swatch grid |

## Explicitly NOT changed

- Pads keep the silkscreen colour on every part including links, so no part can make its
  own pads unreadable.
- The casing under every wire, which is what keeps black and white legible.

## What a green run means

`tests/render/test_wire_colour.mjs` reports `N/N checks passed`: a 3-hole wire is orange and
a 3-4-5 diagonal is green; a 10-hole wire is black and an 11-hole one brown; a wire link's
body takes the wire colour for its span while its pads stay silk; changing a link's `silk`
does not change its wire and changing its `colour` does not change its pads; the palette has
16 entries and includes every code colour; and clearing a colour returns it to the derived
one.
