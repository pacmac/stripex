# SPEC — a selected part can be edited

status: implemented, entry CLOSED
area: editor-ui, board-model
source_hash:
  src/model/edit.js:  95e7e451425268f9aa00f0a9f4c6eaa90d1710526160b8576868d638724b16bc
  public/app.js:      12e930328523df59edb790e375e92f781682be9a3fe3dacfa1a9226c55c56df4

## What the browser actually did

Red 0/22 → green 22/22, entry closed. 14 suites, 228 checks.

A DIP-14 placed, selected, then edited field by field without ever being replaced:

| edit | result |
|---|---|
| span 7 → 8 | 16 pads drawn, 8 cuts derived |
| width 3 → 6 | 0.6 in package, cuts follow |
| ref → `IC3` | selection follows the rename |
| value → `LM358` | |
| rotation → 180° | anchor moved (9,4) → (10,11): turned in place, not swung |
| column → 12 | |

Refusals, each leaving the project untouched and the input showing the stored value:

| typed | message | stored |
|---|---|---|
| width 1 | *DIP / IC socket needs a width of at least 2* | still 6 |
| span 0 | *DIP / IC socket needs a span of at least 2* | still 8 |
| ref `"   "` | *a part needs a reference* | still `IC3` |

A good edit straight after a refused one works and clears the message.

### A defect found by looking

The refusal message was **invisible**: the handler wrote it and then called
`paintInspector()`, which rebuilds the panel and replaces the element the message had just
been written into. Every refusal looked like the app ignoring you. Fixed by repainting
first and writing the message second — verified by reading the text back out of the page
rather than by assuming it was there.

Peter, 2026-08-30: *"a selected componente cannot be edited."*

The Focus panel prints a selected part's ref, package, position, rotation and span as
**text**. Only the value is an input. So changing a DIP-14 to a DIP-16, or a 0.3 in package
to 0.6 in, means deleting it and placing it again — losing its ref, its value and its
position.

## Editable fields

| field | control | applies to |
|---|---|---|
| `ref` | text | every part |
| `value` | text | every part |
| `span` | number | parts with `parametric` |
| `width` | number | parts with a `defaultWidth` (the DIL) |
| `rot` | 0 / 90 / 180 / 270 | every part |
| `col`, `row` | number | every part |

## The editing goes through the model, not the panel

```js
applyPlacementEdit(placement, getPart, field, value) -> { placement, error }
```

A pure function returning either a new placement or a reason it was refused. The panel
renders inputs and shows errors; it does not decide what is legal. That is what makes the
rules checkable in node, and it is the same split that already keeps the renderer testable.

Rules, each of which is a way a typed value can be wrong:

- `span` below the part's `minSpan`, or not an integer → refused
- `width` below `minWidth` → refused
- `rot` not one of the four quarters → refused
- `ref` empty → refused
- `col`/`row` not an integer → refused
- a field the part does not have (`width` on a resistor) → refused

**Refused means unchanged.** The function never returns a half-applied placement, because a
panel that silently keeps part of a rejected edit is worse than one that refuses the lot.

Duplicate refs are **not** refused here: `validateProject` and the DRC already report
`duplicate-ref`, and refusing mid-type would stop you swapping two refs over. It is
reported, not prevented.

## Rotation edits rotate in place

Setting `rot` from the panel goes through `rotatePlacement`, not by writing the field, so a
part turned from the panel behaves exactly as one turned with the button: about its own
centre, not swinging round pin 1.

## What the panel does

Each input commits on `change`, so every edit is one undo step rather than one per
keystroke. A refused edit shows the reason and puts the input back to the stored value.

The Focus panel for a **wire** gains the same treatment for its ref and its two ends.

## Files

| file | change |
|---|---|
| `src/model/edit.js` | **new** — `applyPlacementEdit()`, `editableFields()` |
| `public/app.js` | the Focus panel renders inputs and commits through it |

## Explicitly NOT changed

- Dragging a part on the board. Typing coordinates covers the need; dragging is its own
  task with its own hit-testing.
- Changing which `part` a placement uses. A DIP is not a resistor with a different label,
  and swapping the footprint under a placement would leave its pins somewhere arbitrary.

## What a green run means

`tests/model/test_edit.mjs` reports `N/N checks passed`: every listed field applies; each
refusal above is refused with a message; a refused edit returns the placement **unchanged**;
`rot` edits go through `rotatePlacement` so the part keeps its centre; and `editableFields`
offers `width` for a DIL and not for a resistor.
