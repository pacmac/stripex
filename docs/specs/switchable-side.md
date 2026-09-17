# GAP — a component cannot be moved to the other side of the board

status: in progress
area: board-model

Peter, 2026-09-17: *"been pushing back on this, but there's no choice. an item / component /
object needs to be able to switch layer but have a default layer, mostly top."*

## What is wrong

Which side of the board a part is on is fixed by the part: `part.side`, `top` unless the part
says `copper` (the two 0603s and the SOT-23). No placement can change it: not the Focus
panel, not the API, not a device.

## The trap, found reading the code

`part.side` means **two things at once**:

1. **which face the part is on**, which decides whether a view draws its body or ghosts it;
2. **whether it is surface-mount**: a copper-side pad "never enters the hole", so the
   hole-collision check (`drc.js`), the pen-wire rule (`rules.js`) and `ops.pinsByHole`
   all skip it, and its pads are drawn square as lands.

A placement that simply flipped `side` would take the second meaning with it. A DIP moved
to the copper side would stop occupying its holes, and a second lead could share one with
no finding. So they are split:

| | belongs to | decides |
|---|---|---|
| **side**, `top` or `copper` | the **placement**, defaulting to its device's, then its part's | which view draws the body, and which ghosts it |
| **surface-mount** | the **part**, fixed: a part whose own default side is `copper` | hole occupancy, and square land pads |

`sideOf(part, placement)` returns the placement's side, else the part's default.
`isSurfaceMount(part)` is the part's fact. Everything that asked "does this pad occupy a
hole" asks `isSurfaceMount` now, so its behaviour does not change at all. Only the drawing
reads the placement's side.

## Where it can be switched

- **Focus panel:** a two-way **Top / Copper side** choice beside rotation, as buttons, not
  a dropdown. Peter asked for exactly that trade on the view control before ("can be a
  button group instead. faster").
- **API:** `addPart` accepts `side`; a new op `setSide { ref, side }`. Both go through the
  same edit function the panel uses.
- **Devices:** a device may declare `side`, validated and copied onto the placement like
  everything else it brings. The Components screen shows it as **Mounted on: Top / Copper
  side**, and its preview draws from that face.

`side` is validated wherever it enters: `top` or `copper`, nothing else.

## Explicitly NOT changed

- Nets, cuts and rotation. Which face a part is on changes none of them.
- Stored boards. A placement with no `side` is exactly what it was.
- Hole occupancy and pad shape, by construction (see the table).

## Files

| file | change |
|---|---|
| `src/parts/library.js` | `sideOf(part, placement)`; `isSurfaceMount(part)`; `occupiesHoles` on it |
| `src/parts/devices.js` | `side` validated and copied |
| `src/model/board.js` | a placement's `side` validated |
| `src/model/edit.js` | `side` is an editable field |
| `src/model/ops.js` | `addPart` takes `side`; `setSide`; `pinsByHole` on `isSurfaceMount` |
| `src/net/drc.js`, `src/model/rules.js` | hole occupancy on `isSurfaceMount` |
| `src/render/svg.js` | body shown/ghosted by the placement's side; land pads by `isSurfaceMount` |
| `public/app.js` | the Focus choice; the device field; previews and thumbnails from the device's side |

## What a green run means

`tests/model/test_side.mjs`:

- with no `side`, a resistor is top and an 0603 copper; a placement's `side` wins;
- `applyPlacementEdit` sets `side`, and refuses anything but `top` / `copper`;
- `addPart` with `side` and the `setSide` op both land it; `validateProject` refuses a bad
  side;
- a device `side` validates and travels onto its placement;
- **a DIP on the copper side still occupies its holes:** a resistor lead in one of them is a
  `hole-collision`;
- **an 0603 moved to the top still does not:** no collision with a lead in its hole;
- rendering: a resistor on the copper side is ghosted in the top view and drawn in the
  underside view, the reverse of on top; an 0603's pads stay square on either side.

`tests/browser/test_side_switch.mjs`: selecting a part shows a Top / Copper side choice in
Focus, clicking Copper side ghosts it in the top view, and undo puts it back.
