# SPEC — rotate a part where it sits

status: implemented, entry CLOSED
area: board-model, editor-ui
source_hash:
  src/model/rotate.js:  f6af313f2bab07bf75ea6ff24b064f1b8e5c359bd411776abe8e60f3f01fd208
  public/app.js:        1690b604ea9977af81f693e0cabb719ff29149dd0c3db4a2ee8594842454e45a

## The rounding, and why it had to be proved rather than tuned

The first implementation used `Math.round` and a DIP-14 crept two holes diagonally per
full turn — 11/12 checks, failing exactly the round-trip one.

`Math.round` is not an odd function: it sends 1.5 to 2 but −1.5 to −1. Rotating 180°
negates a centre offset, so `c180 = -c0` and `c270 = -c90`, which makes the four per-turn
deltas exactly `d, e, −d, −e`. Any **odd** rounding function sums those to zero for every
part, whatever its pin geometry; `Math.round` does not, and the residue is the drift.

So the fix is `roundHalfAway(x) = sign(x) * round(|x|)`, chosen because the parity argument
proves the round trip closes — not because it happened to make the DIP pass.

## What the browser actually did

Red 0/12 → green 12/12, entry closed. 4/4 suites green.

A DIP-14 placed at `(10,8)` and rotated four times in Chromium:

| turn | rot | anchor | pins off board |
|---|---|---|---|
| 1 | 90 | (15,6) | 0 |
| 2 | 180 | (17,11) | 0 |
| 3 | 270 | (12,13) | 0 |
| 4 | 0 | **(10,8)** | 0 |

Returned to its exact starting placement, with all fourteen pin coordinates identical to
the start. Before the fix, R1 went from pins `(11,6) (11,17)` to `(11,6) (1,6)` on a single
turn — most of the part off the left edge.

The nothing-selected case now says "nothing selected — the next part will be placed at 90°"
instead of the bare "placing at 90°" that read as a failed action.

Peter, 2026-08-29: *"rotate does not work"*

## What is actually wrong

Rotation fires and the angle changes. The fault is the pivot.

`resolvePins` rotates each pin offset about the placement **anchor**, which is pin 1. That
is right for the model — a placement is an anchor plus an angle, and the anchor has to be
a hole. It is wrong for the *gesture*: a user clicking Rotate expects the part to turn
where it is, not to swing around one of its own legs.

Measured, R1 (axial, span 4) at `at:(4,2)`:

| rot | pins, mm |
|---|---|
| 90 | `(11,6) (11,17)` |
| 180 | `(11,6) (1,6)` |

The part did not turn in place. It pivoted about pin 1 and moved most of its body off the
left edge. At 180 and 270 an axial part extends into negative x and y, so two of the four
angles throw it somewhere useless — and on a part already near an edge, off the board
entirely.

## The fix

A new model helper, because the arithmetic belongs next to the rotation it corrects and
three callers will want it (the editor, a future drag-rotate, and the exporter's
alignment):

```js
rotatePlacement(placement, getPart, quarterTurns = 1) -> placement
```

It returns a **new** placement — never mutates — with:

1. `rot` advanced by `90 * quarterTurns`, normalised into `0..270`
2. `at` shifted so the part's **pin bounding-box centre** stays where it was

Step 2 is the whole fix. Compute the pin bounding-box centre before and after the turn,
take the difference, round it to whole holes, and subtract it from the anchor. Rounding is
required because the anchor must land on a hole: a part with an even pin span has a centre
on a hole, one with an odd span has it on a boundary, and only one of those can be
preserved exactly.

> Rounding means the centre can move by up to half a hole per turn. That is the
> irreducible cost of keeping the anchor on the grid, and it is why the check is "within
> half a hole" and not "exactly equal".

**Four turns must return the placement exactly to its start** — same `at`, same `rot`.
This is the check that catches rounding drift: any implementation that rounds
inconsistently accumulates error and fails it, and a part that creeps a hole every time
you cycle it through 360° is worse than one that swings.

## Editor behaviour

- Rotate with a part selected rotates that part in place.
- Rotate with nothing selected changes the **pending** angle for the next placement, and
  says so plainly. It currently says "placing at 90°" while the user is in Select mode
  and expects something on the board to move; it should name what it is doing.
- `R` does the same as the button.

## Files this changes

| file | change |
|---|---|
| `src/model/rotate.js` | `rotatePlacement()` |
| `public/app.js` | the Rotate handler uses it; clearer message when nothing is selected |

## Explicitly NOT changed here

- `resolvePins` and `rotate()` keep pivoting about the anchor. That is the correct model
  semantics — a placement IS an anchor plus an angle — and every stored project depends
  on it. This spec adds a gesture on top, it does not redefine the geometry.
- Off-board clamping. A part rotated near an edge may still overhang; the DRC already
  reports `pin-off-board`, and silently moving a part the user placed would be worse than
  telling them.

## What a green run means

`tests/model/test_rotate_in_place.mjs` reports `N/N checks passed`, including: an axial
part's bounding-box centre moves by at most half a hole per quarter turn; four turns
restore `at` and `rot` exactly; a DIP behaves the same; the input placement is not
mutated; and a part rotated at the board centre never leaves the board.
