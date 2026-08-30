# SPEC — move a device point to point, by one of its pins

status: implemented, entry CLOSED
area: editor-ui, board-model
source_hash:
  src/model/move.js:      40c3e95b084edb645bff3710e6cedd8e3479787b5a41d43e5ad7e90aaeab9ad8
  src/render/svg.js:      9c2e7a0762777c79fdd8cc06076eafe59ef4c1324678e96f5c9eb9a0cd7489a0
  src/render/cursors.js:  0c290049229484714cf5cff7796dcdeae40f0f159a5e9565e74cbbba67de05e2
  public/app.js:          99bb4ef47b022de710f2bd3d52a9e78db059d916c58ac9e56132da127b6084cb
  public/index.html:      a8692242ba99eff974eb3839f9d8faee8b568f0b45c5cdccab322fc1f802eb5e

## What the browser actually did

Red 0/13 → green 13/13, entry closed. 17 suites, 269 checks.

A DIP-14 at (4,3), moved by pin 1 to hole (14,10):

- arming pin 1 drew one handle marked `U1` / pin `1`, status *"holding U1 by pin 1 — click
  the hole it goes in"*
- after the second click, pin 1 sits at **(36.83, 26.67) mm** and hole (14,10) is at
  **(36.83, 26.67) mm** — identical, not merely close
- the handle cleared, the package came with it, no DRC errors
- arming pin 8 then pin 14 re-armed twice without moving anything
- `Esc` cleared the handle

## A defect found by looking

The first attempt did not arm at all. The pads are drawn `fill="none"`, and SVG's default
`pointer-events="visiblePainted"` makes only the **0.12 mm stroke** hit-testable — a click
in the middle of a pad fell straight through to whatever was underneath. Aiming at a pin
was impossible.

Fixed with `pointer-events="all"` on the pads. Worth remembering: an unfilled SVG shape is
a ring you can only click on the edge of, which for a 0.66 mm pad is no target at all.

Peter, 2026-08-30:
*"a component cannot be dragged and dropped using a snap to position."*
then: *"I think a better method of move / drag & drop would be to select a pin, the pin then
shows it is selected, then move the cursor to another hole and the device moves to there,
similar to F360 point to point moves."*

## Why this beats dragging

A drag has to decide where a part landed from where the pointer was released, and then snap
that guess to a grid. Two clicks on two holes have nothing to guess: **the pin you picked
goes in the hole you clicked**, exactly. There is no snap tolerance to tune and no "it
dropped one hole out" to report.

It is also the only method that works when the part is bigger than the space around it: you
can grab the exact pin you care about — pin 1 of a DIL, the cathode of a diode — and put
*that* pin where it must go, rather than aiming the part's middle at nothing in particular.

## The gesture

Move tool, `M`, crosshair cursor.

1. **Click a pin.** It is marked as the move handle. The status line says which part and
   which pin.
2. **Click a hole.** The device moves so that pin lands there. The handle clears.

`Esc` cancels an armed handle. Clicking a second pin before choosing a hole re-arms on that
pin rather than moving — picking up the wrong pin costs a click, not an undo.

Clicking anywhere that is not a pin while nothing is armed does nothing and says so.

## The model does the arithmetic

```js
movePlacementByPin(placement, getPart, pinName, target) -> placement
```

Pure, returns a new placement. The translation is `target - (where that pin currently is)`,
applied to the anchor. Rotation is untouched: this is a move, not a transform.

An unknown pin name returns the placement unchanged rather than throwing, because a stale
handle — the part edited or replaced between the two clicks — must not take the editor down.

## Drawing

The armed pin gets `data-kind="move-anchor"`: a filled ring in the selection colour, drawn
last so nothing covers it. It is not the selection halo; a part can be selected and not
armed, and armed without being selected.

## Off-board moves are allowed, and reported

A move that puts pins off the board is **not refused**. The DRC already says
`pin-off-board`, and refusing would make it impossible to shuffle a part across a crowded
board in two steps. Moving it back clears the finding.

## Files

| file | change |
|---|---|
| `src/model/move.js` | **new** — `movePlacementByPin()` |
| `src/render/svg.js` | draw the armed pin |
| `src/render/cursors.js` | crosshair for the move tool |
| `public/app.js` | the tool, its two clicks, and `Esc` |
| `public/index.html` | the toolbar button |

## Explicitly NOT changed

- Free dragging. This replaces the need for it; adding both would be two ways to do one
  thing, differing only in precision.
- Moving wires or breaks. A wire's ends are typed in the Focus panel; a break belongs to
  its row.

## What a green run means

`tests/model/test_move.mjs` reports `N/N checks passed`: the named pin lands exactly on the
target hole; every other pin keeps its offset from it; rotation and span are untouched; a
move by pin 1 and a move by pin 8 to the same hole put the part in different places;
moving to a pin's current hole is a no-op; an unknown pin returns the placement unchanged;
and the input is never mutated.

Plus, in a real browser: arm pin 1 of a DIL, click a hole eight columns away, and confirm
pin 1 is in that hole and the package came with it.
