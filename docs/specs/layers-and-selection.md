# SPEC — layers, and a selection you can see

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:   8944686751fd0eb79eaf3b4a584fc2da949d4b37bc14f91bacd8cc863f05c928
  public/app.js:       02f3c977cbb4b3a47712374584af112345b9aae0b122759193b7e9ae821f97a6
  public/index.html:   4bb7320bfa6de230d31cd9c5c93d12e39684ebd109fc3c5f1d20f487cf1fbbec
  public/style.css:    40667ef30bcd92982472b62a8a83a8659e543bf15ce8957e561a6191805057e4

## What the browser actually did

Red 8/21 → green 21/21, entry closed. Driven in Chromium at 1600×1000, both themes.

- Hiding `components` left `L1` drawn and removed `R1`; hiding `links` did the reverse.
  The two are genuinely independent, which is the thing that was asked for.
- "all" restored every layer.
- Selecting a part, a wire and a break each produced exactly one halo naming that object,
  marked the object with `data-selected`, and named it in the status line.
- `Esc` cleared it.
- The halo renders in both themes (`#0a7ea4` light, `#3fc9f0` dark).

### A defect this spec caused, found by looking

The spec claimed the place and wire tools would fall back to pointer arithmetic when the
`holes` layer is hidden. **They did not** — both hit-tested on `[data-hole]` elements that
no longer existed, so hiding the holes layer silently switched off two tools. A layer
control that disables tools is worse than no layer control.

Fixed in `onBoardClick`: hit the drawn hole first, fall back to the pointer arithmetic the
break tool already used. Verified by hiding the layer and then drawing a wire (1 → 2) and
placing an LED (2 → 3 parts) with nothing to hit.

Peter, 2026-08-29: *"1) you need to use layers so that components, links etc can be
hidden. 2) there is no way to tell what object is selected."*

Both are the same class of fault: the editor knows things the picture does not say. The
renderer already receives `selection` and does almost nothing visible with it, and there
is no way to get a crowded board out of your own way.

## Layers

Eight, each independently hidden:

| layer | covers | default |
|---|---|---|
| `copper` | strip segments | on |
| `breaks` | cut markers | on |
| `holes` | the hole matrix | on |
| `wires` | pen wires and their refs | on |
| `links` | placements of a part whose `kind` is `link` | on |
| `components` | every other placement | on |
| `labels` | refs and values | on |
| `drc` | error and warning rings | on |

**`links` and `components` are separate layers**, because they are different jobs: a link
is a connection you are checking, a component is a part you are placing. Hiding one must
not hide the other — that is the distinction Peter named explicitly.

`renderBoard(project, { layers })` takes a partial object; anything absent defaults to
visible, so an old call site keeps working and a saved project missing the field opens
with everything shown.

A hidden layer emits **no elements**, rather than transparent ones. Invisible-but-present
elements still swallow clicks, so hiding the components layer to reach the copper beneath
it would not work — which is the entire reason to have the feature.

`holes` hidden is a special case: holes are the click target for the wire and place tools.
Hiding them leaves the tools working, because hit-testing falls back to the pointer-to-hole
arithmetic that the break tool already uses.

## Selection

Selection state is `{ kind: 'part' | 'wire' | 'break', ref }` — `break` is new; a cut is a
thing on the board and must be selectable and deletable like anything else.

What the picture must show:

- a **halo** drawn *behind* the selected object, in the accent colour, at a stroke width
  that reads at every zoom: a rounded rect around a part's pin bounding box, a thick
  underline along a wire, a ring around a break marker
- `data-selected="true"` on the object itself
- the object drawn last within its layer, so nothing overlaps the thing you just clicked

The halo is a separate element with `data-kind="selection"`, not a style change on the
object. A style change is invisible on a part whose body already fills its bounds, which
is precisely the DIP — the case where telling parts apart matters most.

Selecting also:
- fills the **Selected** panel (already does)
- marks the matching row in the Checks, Nets and Run list panels with `data-selected`
- shows the ref in the status line

Clicking empty board clears it. `Esc` clears it. Deleting the selected object clears it.

## Files this changes

| file | change |
|---|---|
| `src/render/svg.js` | `layers` option; per-layer emission guards; the selection halo |
| `public/app.js` | layer toggle state and UI; break selection; panel row marking |
| `public/index.html` | the layers panel |
| `public/style.css` | layer panel and selected-row styling |

## Explicitly NOT changed here

- `src/model/**`, `src/net/**` — layer visibility is a view concern and must not reach
  the model. A hidden layer changes nothing about the nets or the DRC: a hidden link
  still joins its strips, and the checks still report it. Hiding is not deleting, and a
  tool that quietly stopped counting hidden parts would be lying.
- The spot-face break type, which is its own register entry.

## What a green run means

`tests/render/test_layers_and_selection.mjs` reports `N/N checks passed`, including: each
layer hidden emits zero elements of its kind; hiding `components` leaves `links` drawn and
the reverse; a hidden layer changes neither the net count nor the DRC findings; a selected
part, wire and break each produce a `data-kind="selection"` halo; and nothing is selected
by default.
