# SPEC — a part's cuts belong to the part

status: implemented, entry CLOSED
area: board-model, connectivity, editor-ui
source_hash:
  src/model/breaks.js:  9d09673d6c97f042b765d3f6967ed8611bc0c3d9532da2d2b03a3dba81d4d96b
  src/render/svg.js:    117d7de569949865548d3ef4153aaf473da22d083bed6815c622232d253b94e3
  public/app.js:        1f70515333477210b2b09343360a6360417951f12c5cca9282065b63e9c9fa23

## What the browser actually did

Red 0/17 → green 17/17, entry closed. 11 suites, 183 checks green.

A DIP-14 placed straddling the strips, then turned through four right angles:

| step | cuts drawn | cuts **stored** | errors |
|---|---|---|---|
| placed | 7 | 0 | 0 |
| rotate 90 | 12 | 0 | 0 |
| rotate 180 | 7 | 0 | 0 |
| rotate 270 | 12 | 0 | 0 |
| rotate 360 | 7 | 0 | 0 |
| **part deleted** | **0** | 0 | 0 |

The count changing between 7 and 12 is correct: straddling the strips the package needs one
cut per strip, but lying along them it needs six between the pins of each row. The column
that matters is the middle one — nothing is ever stored, so nothing can be left behind.

With the components layer hidden so the cut underneath was clickable:

- selecting an owned cut says *"U1 cannot work unless this strip is cut, so the cut belongs
  to it"*
- deleting it is refused: *"that cut belongs to U1 — move or delete U1 instead"*, all seven
  still drawn
- a user's own cut elsewhere still deletes normally, and the owned ones are untouched

### A correction to one check, after the red

The check `ROTATING THE PART MOVES ITS CUTS` originally asserted the cut count stays at
seven. That was my error, not the code's: a DIP-14 turned along the strips genuinely needs
twelve. Rewritten to assert the property that actually matters — the board's cuts equal
exactly what the current placement requires, so a stale one from the previous orientation
fails it. The red (0/17, nothing existed) stands; one expected value in it was wrong.

### Two false alarms I raised against myself

Both were faults in my browser probes, not the app: I clicked row 18's y coordinate while
the cut was in row 19, and I called `.check()` on an already-checked radio so no change
event fired and the delete tool stayed armed. Re-run at the right coordinates, user cuts
delete correctly and owned cuts survive.

Peter, 2026-08-30: *"when I delete a component it's associated track breaks remain, same
issue with rotation, the track breaks dont move with the component. this is a design
architecture issue."*

## I got this wrong, deliberately, and here is the correction

`docs/specs/cuts-and-mounting.md` argues:

> Auto-inserted cuts are not tracked as belonging to their part. Making them self-removing
> would model a board you cannot actually build.

That reasoning was about a **finished board**, where copper does not un-cut itself. But
this is a design tool, used *before* anything is cut. In a design, a cut that a chip
requires is a property of the chip: move the chip and the cut moves, delete the chip and
the cut was never needed. Leaving it behind accumulates junk cuts nobody asked for and
that no real board would ever have.

Peter is right that it is architectural, so the fix is architectural rather than a
delete-hook and a rotate-hook that have to remember each other.

## The fix: derive, do not store

A part's required cuts are **not stored at all**. They are computed from the placements
whenever the board is interpreted:

```js
effectiveBreaks(project) -> [ ...project.breaks, ...derived ]
```

Nothing has to move a cut when a part rotates, and nothing has to clean up when a part is
deleted, because there was never a stored copy to get out of step. That is the whole point
of the change: the two bugs Peter reports are the same bug — one stored fact derived from
another — and deriving it removes both at once rather than adding two more hooks.

`project.breaks` holds **only cuts the user made**. Derived cuts carry `owner: <ref>` so
the renderer and the editor can tell them apart.

## What this explains

Peter also reported: *"when I rotate a component, the DRC markers disappear"*.

Same cause. Rotating a DIL added a fresh set of cuts at the new orientation while the old
ones stayed, so the part stopped being shorted and its error — and its markers — went away.
The markers were correct about a board that had silently acquired cuts nobody asked for.

Measured before the fix: a resistor along a strip shows 2 markers at rot 0 and 180, and 0
at 90 and 270, which is genuinely correct for a resistor. The DIL case is the one that was
wrong.

## Rules

- A derived cut is `{ row, x, at: 'gap', owner: ref }`.
- A user cut at the same place wins; the derived one is not duplicated.
- **A derived cut cannot be deleted on its own.** Clicking it with the delete tool, or the
  Focus panel's remove button, says so and names the part. Removing it means moving or
  deleting the part — which is true of the real board too.
- The break tool may still cut anywhere, including where a part already implies a cut; that
  becomes a user cut and is simply redundant.

## Consequences

- `missing-required-break` can no longer fire through `findingsFor`, because the cuts a
  part needs are always present. The check stays in `drc()` for the low-level call, where a
  caller passes an explicit break list — that is what the existing checks exercise.
- The cut list an exporter prints must come from `effectiveBreaks`, not `project.breaks`,
  or half the cuts would be missing from the sheet you build the board from.
- Projects saved before this change already contain the old auto-inserted cuts as ordinary
  user cuts. **They stay**, because nothing can tell which were automatic. Stated rather
  than hidden: an old board opened after this change may carry cuts that a new one would
  not, and they can be deleted by hand.

## Files

| file | change |
|---|---|
| `src/model/breaks.js` | `effectiveBreaks()`, `derivedBreaks()`, `ownerOf()` |
| `src/render/svg.js` | render from effective breaks; mark owned ones |
| `public/app.js` | drop the place-time and rotate-time merges; refuse to delete an owned cut |

## Explicitly NOT changed

- `segments()`, `drc()` and `nets()` keep taking an explicit break list. They are the
  low-level functions and their checks depend on being handed exactly what to consider.
  Derivation happens one level up, in the project-shaped helpers.
- `requiredBreaks()` itself. It already computes the right cuts; this changes who stores
  the answer.

## What a green run means

`tests/model/test_owned_breaks.mjs` reports `N/N checks passed`, including: a DIL's cuts
appear in `effectiveBreaks` without being in `project.breaks`; **rotating the part moves
them**; **deleting the part removes them**; a user cut at the same place is not duplicated;
derived cuts carry their owner and user cuts do not; and a board with no `requiresBreak`
part has `effectiveBreaks` equal to `project.breaks`.
