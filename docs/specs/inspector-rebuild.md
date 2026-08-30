# SPEC — editing a field must not destroy the field

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/panels.js:  21b0302ce7bf88f5ff0d4e74b6b305df51c9516487a1806a1210f42dc983f015
  public/app.js:         aa8f1ebe62c2619cdb5bb5816d854387927d9f8812f393d015ebcb3b9bd8ee4d

## What the browser actually did

Red 0/14 → green 14/14, entry closed. 15 suites, 242 checks.

Four consecutive ArrowUp presses on the width field, which before gave one increment and
then nothing:

| press | width | focus |
|---|---|---|
| 1 | 4 | `width` |
| 2 | 5 | `width` |
| 3 | 6 | `width` |
| 4 | 7 | `width` |

## A second bug, created by this fix and caught by measuring

Removing the rebuild exposed a latent fault: **the change handlers closed over the
placement captured when the panel was built.** While the panel rebuilt after every edit
that closure was refreshed each time, so it never showed. Without the rebuild it goes
stale, and editing `span` wrote back a placement still carrying the *old* width — silently
undoing the previous edits. Measured: width taken 3 → 7 with arrows, then one span edit
put width back to 3.

Fixed by looking the placement up by ref at event time instead of using the captured copy;
the same applies to the wire panel.

It was only visible because the check read the value back out of `localStorage` rather than
off the screen. The screen showed the right number the whole time.

Verified after the fix: width +3 → 6, then span +2 → 6, and **width is still 6**. Then a
value edit, then a refused width of 1 which puts 6 back and leaves the field focused and
usable — the next ArrowUp gives 7.

Peter, 2026-08-30: *"component span and width cannot be edited / changed when a device is
selected and it's params are shown in the focus tab."*

## Measured

They can be edited — **once**. Then the field is dead.

| step | width | focus |
|---|---|---|
| click the width field | 4 | `width` |
| ArrowUp | **5** | **`BODY`** |
| ArrowUp | 5 | `BODY` |
| ArrowUp | 5 | `BODY` |

Clicking the spinner arrow with the mouse is the same: the first click changes nothing
further, because each click lands on an element that is then thrown away.

## Cause

Every edit calls `commit()`, which calls `draw()`, which calls `paintInspector()`, which
does `el.innerHTML = ...`. That replaces the input the user is currently typing into. The
value is committed correctly — it is the *field* that disappears, taking the focus and the
caret with it.

It looks exactly like "cannot be edited", because after the first change nothing you do to
that field has any effect.

## Fix: rebuild only when the panel's SHAPE changes

The panel's structure depends on which object is selected and which fields its part offers.
It does **not** depend on the values in those fields.

```js
inspectorKey(selection, target, part) -> string | null
```

A pure function returning a string that changes when the panel must be rebuilt — different
object selected, different part, a different set of editable fields — and stays the same
when only a value changed.

`paintInspector` then:

- **key changed** → rebuild the HTML and attach handlers, as now
- **key unchanged** → leave the DOM alone and write current values into the inputs,
  skipping any input that currently has focus

Skipping the focused input matters: writing a value back into the field being typed in
would fight the user's caret even without a rebuild. The stored value and the shown value
agree the moment focus leaves.

## Consequences

- Repeated spinner clicks and repeated arrow presses work, because the element survives.
- Typing continues to commit on `change`, so one edit is still one undo step.
- A refused edit still repaints — the point there is to put the rejected value back, and
  the key is unchanged so it is now a value sync rather than a rebuild.

## Files

| file | change |
|---|---|
| `src/render/panels.js` | `inspectorKey()` |
| `public/app.js` | `paintInspector` rebuilds only on a key change |

## Explicitly NOT changed

- What the fields do. `applyPlacementEdit` is unaffected.
- The other three tabs, which are read-only and can be rebuilt freely.

## What a green run means

`tests/render/test_inspector_key.mjs` reports `N/N checks passed`: the key is stable across
a change of span, width, value, rotation and position; it changes when a different object is
selected, when the ref changes, when the part changes, and when the set of editable fields
differs; a null selection gives a null key; and a part and a wire with the same ref do not
collide.

Plus, in a real browser: three consecutive ArrowUp presses on the width field give three
increments and leave focus in the field.
