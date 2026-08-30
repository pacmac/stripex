# SPEC — a cut under a component can still be clicked

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  04651d360c4be6f16e3407c1af94d34cd3f4089ef18871dd991ac5b1f6ad6c09
  public/app.js:      5debe4d15e042f9bb3106374c2c21d2da4e12743d0707f125999bc31f34133ed

## What the browser actually did

Red 5/10 → green 11/11, entry closed. 22 suites, 336 checks.

A DIP-14 placed with its seven own cuts, **no layer hidden**:

- the element under the pointer at a cut is `break-hit`, naming `4,9`
- clicking it selects the cut and the inspector says *"Cut for U1 … U1 cannot work unless
  this strip is cut"*
- the delete tool still refuses it by name: *"that cut belongs to U1 — move or delete U1
  instead"*, all seven cuts intact
- clicking the body away from a cut selects **U1**

## The size had to be measured, not guessed

My first version used a generous target — the full drawn marker. Sampling an 8×8 grid over
the DIL's body, **44% of it selected a cut rather than the chip**: seven 2.84 mm circles
down the middle of a 12.7 mm-wide package. Selecting the chip was close to a coin flip.

The spec's own justification was wrong here — "a cut's target is at most 2.8 mm against a
body tens of millimetres" is true of *one* target and false of seven in a line.

Targets are now pad-sized, 1.73 mm, which the move tool proves is comfortably clickable.
The same sample gives 25%, and that is a coarse grid overstating it: by area the centre
strip is about 14% of the body, and it is exactly where the cuts are, so which half of the
package you are clicking is predictable rather than random.

A check now asserts a target is no bigger than a pad, so this cannot regress.

---

# Three follow-on requests, and one defect found while verifying

## Wire links default to vertical

Peter: *"wire links should default to vertical."*

`part.defaultRot`, which the palette arms when you pick the part. The wire link declares 90.

It is the only orientation in which a link is a link: **along** a strip it joins a segment
to itself and the DRC calls it `link-redundant`. That should not be the default you have to
remember to change. Checked both ways — at 90 the two strips become one net, at 0 the
finding fires.

## The Delete key

Peter: *"delete key should be mapped to delete button."*

`Delete` and `Backspace` both arm the Delete tool. Backspace as well because on many
keyboards that is the key labelled Delete; both are `preventDefault`ed, since Backspace
navigates back in some browsers.

The map lives in `src/render/keys.js` so a check can assert **every tool the toolbar can arm
is reachable from the keyboard** — the same trick as the cursor map, which caught the move
tool the day it was added.

## The status line went stale — found, not reported

While verifying the hit targets I clicked bare board, the selection cleared, and the status
line went on saying *"selected break at 4,9"*. It made me misread my own test result, which
is what a stale readout costs.

`draw('')` means "clear the line", and the editor tested the message for **truthiness** —
and `''` is falsy. The distinction is presence, not truthiness: `''` clears, `undefined`
leaves it alone. `shouldSetStatus` now says so in one place a check can reach.

Filed as its own entry with its own red rather than folded in silently, because a fix made
in passing with no failing check first is exactly what this workflow exists to stop. The
one-line fix was reverted, the check written, the red taken, and the fix reapplied.

## Results

| entry | red | green |
|---|---|---|
| a cut under a component cannot be clicked | 5/10 | 11/11 |
| wire links default to lying along a strip | 3/7 | 7/7 |
| the status line goes stale | 0/4 | 4/4 |
| the delete key does nothing | 1/7 | 7/7 |

25 suites, 354 checks. Verified in Chromium: a wire link places at rot 90 bridging two
strips with no redundancy finding; `Delete` and `Backspace` each arm the Delete tool from
Select; and the status line clears to empty on deselect.

Peter, 2026-08-30: *"a knife break or spot face behind a componnet cannot be selected."*

## Cause

Paint order is copper, breaks, holes, wires, parts. A part is painted **after** the breaks,
so its body — translucent, but painted — is the topmost element over any cut beneath it and
takes the click. Every cut under a DIL is therefore unreachable, which is precisely the set
of cuts a DIL creates.

I met this myself while checking the owned-cut work and worked around it by hiding the
components layer, rather than filing it. It was a bug then and it is the same bug now.

## Fix: an invisible hit target above the parts

Each break emits a second element after the parts are drawn:

```
data-kind="break-hit"  data-break="<row>,<x>"  fill="none"  pointer-events="all"
```

Invisible, so the drawing is unchanged — the cuts still show *through* the translucent body
where they are, which is right, because that is where they physically are. It exists only to
be clicked.

> Precision decides who wins. A cut's target is 2.8 mm across at most; a DIL's body is
> tens of millimetres. Click exactly on the cut and you get the cut; click anywhere else on
> the part and you get the part. That is the behaviour you would expect from any editor:
> the most specific thing under the pointer.

## Rules

- One hit target per drawn break, and **only** for drawn breaks: hiding the `breaks` layer
  removes the targets with the markers, or a hidden layer would still be swallowing clicks —
  the exact fault the layer feature exists to avoid.
- The target matches the marker's shape and position: a rect over a knife cut, a circle
  over a spot-face.
- The editor treats `break-hit` exactly as it treats `break`, so select, delete and the
  owned-cut refusal all work through it unchanged.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | emit the hit targets after the parts |
| `public/app.js` | hit-test `break-hit` as well as `break` |

## Explicitly NOT changed

- The visual paint order. Cuts stay under the parts, seen through them.
- Which of a part and a cut wins when neither is under the pointer exactly — nothing
  changes for a click on bare board.

## What a green run means

`tests/render/test_break_hit.mjs` reports `N/N checks passed`: every drawn break has one hit
target; each target comes **after** every part in the document, so it is on top; targets are
invisible and `pointer-events="all"`; a spot-face gets a circle and a knife cut a rect;
hiding the breaks layer removes both marker and target; and a board with no breaks emits no
targets.

Plus, in a real browser: a DIL placed with its own cuts, then one of those cuts clicked with
the Select tool **without hiding any layer**, and the cut selected.
