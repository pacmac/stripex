# SPEC — never lose a board

status: implemented, both entries CLOSED
area: storage-api, editor-ui
source_hash:
  src/model/repair.js:   a4556be436bec1b0492c40ad39139c79dfaa8029d9e5f8cd54dd2ed171165e5e
  src/model/history.js:  08d758f7ad8f4539fcaff623f178e4ac0666b879d755e9a283ee7ee374d8c6c4
  public/app.js:         bbbbf1c7c702c743588c7e6651ad7396a1d07b7c1be60bc1ea9f1fdcea95f286
  public/index.html:     4201e673bc55905a1445d5c103d0355b4875f95068cfda1743e3b07f73a98b46
  public/style.css:      dfa703ecba4639890a0ddd3acc7ab42b04b5884e621ae1adfa301df8516551df

## What the browser actually did

Red 0/12 and 0/9 → green 12/12 and 9/9, both entries closed. 31 suites green; the 32nd is
the net-label feature, still unbuilt.

**Peter's actual lost board, fed to the real editor with all five illegal placements still
in it:**

| | |
|---|---|
| parts drawn | **13** — TMC2209, J1, J2, J3, L1–L8, R1 |
| cuts drawn | 13 |
| banner | *"5 things in the stored board could not be opened and were left out. The rest is intact. A1 was a Point to point (pen) placed as a component, which it cannot be. It was at hole 8,9 — draw it with the wire tool…"* |
| page errors | 0 |

The five are **named with their positions**, so nothing disappears without saying so.

**History**: one edit produced one snapshot holding 14 parts.

**Escape**: palette armed `true` → press Escape → tool `select`, palette armed `false`.

`tests/model/test_repair.mjs` loads `recovered/original-as-saved.json` directly, so the
board this failed on is now a permanent check. It cannot regress without that file failing.

## A blank page, shipped and caught, in the middle of fixing blank pages

The first cut of this put `let loadRepairs = []` **below** the `state` declaration. `state`
calls `load()` during its own initialisation, so the `let` was in its temporal dead zone:

```
ReferenceError: Cannot access 'loadRepairs' before initialization
    at load (app.js:115) at app.js:75
```

A blank page — the exact failure this work exists to stop — introduced while stopping it.
Every node suite passed, because they test the modules and **nothing checks that app.js
boots**. Phase 4 caught it, which is the only reason it is a paragraph here rather than
another thing Peter found.

That gap is real and is filed: `nothing-checks-that-the-editor-boots`.

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

## Two more, found while reading the code for this

**`persist()` swallows a full disk.**

```js
try { localStorage.setItem(STORE_KEY, JSON.stringify(state.project)); } catch { /* full */ }
```

An empty catch with a comment where the handling should be. Once the quota is hit, every
later edit is silently not saved; you keep working and find out on reload. `persist()`
returns whether it wrote, and a failure raises a banner — *"not saved: storage is full"* —
rather than a comment nobody reads.

**Escape leaves the palette lit.** `buildPalette` marks an item `is-on` from `state.part`;
`setTool` only touches `.tool` buttons. They are independent, so `Escape` arms Select while
the palette still shows a part chosen, and nothing on screen says the next click will not
place. The palette shows a part as armed **only while the place tool is armed**.

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
