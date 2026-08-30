# SPEC — never lose a board

status: draft
area: storage-api, editor-ui
source_hash: (set in Phase 5)

Peter, 2026-08-30: *"if I spend time designing a board I dont expect it to disappear."*

He is right, and this happened because of three faults of mine compounding.

## What went wrong

**1. `load()` throws the board away.**

```js
const problems = validateProject(p);
if (problems.length) {
  console.warn('stored project rejected:', problems);
  return null;                        // ← an empty board
}
```

A project that fails one check is discarded whole, with a console warning nobody sees, and
replaced by a blank board.

**2. I made a valid board invalid, an hour after he drew it.** The `not-a-placement` rule I
added rejects a placement of a wire-only part. His board had five, `A1`–`A5`. Every one of
his thirteen real parts was thrown away because of five marks the editor itself had let him
create.

**3. There is no history.** One bad load and there is nothing to go back to. His XIAO was
already missing from the snapshot he recovered, and **there is no way to find out when it
went or to get it back** — that is the part I cannot undo.

## The rules

> **A board is never discarded. It is repaired, and the repair is reported.**

`loadProject(raw)` returns `{ project, repairs }`:

- unreadable JSON → the last good snapshot, and say so
- a placement of a wire-only part, or of an unknown part → **dropped from the placements,
  kept in `repairs`** with its ref and position, so it can be named on screen rather than
  vanishing
- anything else validation dislikes → the field is corrected where a correct value is
  obvious, and reported where it is not
- **only if nothing at all can be salvaged** does it fall back to a snapshot, and then to an
  empty board — announced, never silently

A repair is shown as a banner naming what changed, not a console line.

## History

Every commit writes a snapshot. `stripex.history` holds the **last 30**, newest first, each
`{ at, project }`.

Thirty because a snapshot of Peter's board is about 2 KB, so thirty is ~60 KB against a
5 MB localStorage budget — under 2%. The number is derived from that, not picked: it is the
largest round number whose worst case stays negligible, and thirty edits is more than enough
to walk back past a mistake nobody noticed at the time.

Writing history must never break saving: if the quota is hit, the oldest snapshots are
dropped until the write succeeds, and the current board is always written first.

A **Restore** control lists the snapshots by time and how many parts each held, so "the one
before it went blank" is findable by looking rather than by counting clicks.

## Files

| file | change |
|---|---|
| `src/model/repair.js` | **new** — `loadProject()`, `repairProject()` |
| `src/model/history.js` | **new** — `pushSnapshot()`, `readHistory()`, capacity handling |
| `public/app.js` | use both; the repair banner and the Restore list |
| `public/index.html`, `public/style.css` | the Restore control |

## Explicitly NOT changed

- `validateProject`, which stays strict. Being strict is right; **acting** on strictness by
  deleting the user's work is what was wrong.
- The Save button, which already downloads a file and remains the way to keep a board
  outside the browser.

## What a green run means

`tests/model/test_repair.mjs` and `tests/model/test_history.mjs` report `N/N checks passed`:
a board carrying wire-only placements loads with its **other placements intact** and the
dropped ones listed; Peter's actual saved board loads with all thirteen parts and five
repairs; unreadable JSON falls back rather than blanking; a board that needs no repair is
returned unchanged with an empty repair list; history keeps the newest 30 and drops the
oldest; a snapshot survives a round trip; and a quota failure degrades to fewer snapshots
rather than losing the current board.
