# SPEC — undo restores the state you were in, not the state you are in

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/model/undo.js:  62182603b68190b6795396261cc534c36461c570718f307ea3df4df40525c9a7
  public/app.js:      2b14753e0fedb674aab88138e355536dda59936d2ded91d8a7512c6bb126bc16

Peter, 2026-08-30: *"undo no longer works."*

## What it actually does, measured

Place R1, place R2, then press Undo three times:

| | placements | status line |
|---|---|---|
| after placing R1 | `R1` | placed R1 |
| after placing R2 | `R1 R2` | placed R2 |
| **undo** | `R1 R2` | **"undone"** — and nothing changed |
| undo | `R1` | undone — R2 is gone at last |
| undo | `R1` | **"nothing to undo"** |

So: the first press does nothing, every later press is one step behind, and **the first change
of a session can never be undone at all**.

## It is not a regression

`commit()` has looked like this since `6a0c10e`, the first commit of the editor:

```js
function commit(label) {
  state.undo.push(JSON.stringify(state.project));   // the project AFTER the change
  ...
}
```

Every tool mutates `state.project` in place and *then* calls `commit`, so the stack holds
**post-states**. `undo()` pops one and installs it — which is the state you are already in.
The stack has always been one entry out, and it has never held the state before the first
edit, because nothing ever pushed it.

Saying "I broke it last week" would have been the comfortable answer and it would have sent
the search to the wrong commits. `git log -S` on that line names two commits, and the older
one is the editor's first.

## The fix

Snapshot the state **before** the change. Not by asking every call site to remember — there
are fifteen of them and one would eventually forget, which is the same failure in a new place.

A **baseline**: the project as it stood after the last commit. `commit` pushes the baseline
and then becomes the new baseline.

```js
undo.commit(project)   // pushes the PREVIOUS project, keeps this one as the baseline
undo.undo(project)     // -> the previous project; the current one goes to the redo stack
undo.redo(project)     // the mirror image
```

Set the baseline at boot, and let `commit` move it thereafter.

**Load and Restore stay undoable**, which is what they already did — they pushed the board on
screen before replacing it, and the comment on Restore gives the reason: *"or restoring would
be the one action with no way back"*. So they call `commit` like any other change rather than
`reset`. `reset` exists for the one case that is genuinely a new starting point, at boot.

## Why it becomes a module

`src/model/undo.js`, pure, holding two stacks of strings and no notion of the DOM.

The reason is not tidiness: **there is no way to test this defect where it currently lives.**
`commit`, `undo` and `redo` are functions inside `public/app.js` closing over `state`, and the
node harness has no DOM. A bug that has survived since the first commit survived precisely
because nothing could reach it. A check that cannot exist is how this one lasted, so the fix
includes somewhere to put the check.

It is also the first small piece of `there-is-no-headless-way-to-build-a-board`, and is shaped
to fit it rather than to be undone by it.

## Files

| file | change |
|---|---|
| `src/model/undo.js` | new: the two stacks, the baseline, and the bound |
| `public/app.js` | `commit`/`undo`/`redo` call it; the baseline is reset where the project is replaced |

## Explicitly NOT changed

- Snapshots rather than command/inverse pairs. That decision is right and the reason it was
  taken — *"an inverse-command stack would need every tool to get its own undo right, and one
  of them eventually would not"* — is exactly the reasoning that makes the baseline belong in
  one place too.
- The 200-entry bound.
- `src/model/history.js` and the Restore button, which are a different mechanism: snapshots
  across sessions in localStorage, not the in-session stack.
- Selection being cleared on undo.

## What a green run means

`tests/model/test_undo.mjs` reports `N/N checks passed`:

- **the first change of a session is undoable** — the case that was impossible;
- one undo returns the state before the last change, not the state after it;
- three changes undo in reverse order and redo back in order;
- a new change after an undo clears the redo stack;
- the stack is bounded and drops the OLDEST entry, never the newest;
- undoing with nothing to undo reports that and changes nothing;
- what comes back is a deep copy: mutating it does not corrupt what is still on the stack.

Plus, in a real browser: place two parts, and two undos leave an empty board.
