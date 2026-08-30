# SPEC — delete fires once

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/keys.js:     0f6c680df96e7e869d91d89870c674df852a2e6087d7d5708658184683aeb9e4
  src/render/colours.js:  386e0fd0cc936b3f0be2a8554938fff46d93f1107474be1c30206264ec1c5304
  public/app.js:          c5e9201a6460997e38b0febebaa744bdad75dadc62a4871754f47a58c76a911b

Peter, 2026-08-30: *"delete is a command that can eaily be misused. after a component is
deleted, the mod should switch back to select."*

## What is wrong

The delete tool stays armed. Delete a resistor, then click anywhere near another part to look
at it, and that one is gone too. Nothing on screen changes between "about to delete" and "just
deleted", so the only thing standing between you and a second deletion is remembering which
tool is still lit.

Every other destructive action in this editor takes two decisions. This one takes one, and
then keeps taking one.

## The rule

**A delete that actually removed something returns the tool to Select.** A delete that removed
nothing does not.

The distinction matters: clicking slightly off a pad, or on a cut that belongs to a component
and is therefore refused, leaves you still aiming at the thing you meant to hit. Disarming
there would cost a click every time you missed, and would train you to re-arm without looking
— which is how the tool ends up armed when you think it is not.

| what happened | tool after |
|---|---|
| a part removed | **select** |
| a pen wire removed | **select** |
| a cut restored | **select** |
| nothing under the pointer | delete, still armed |
| a cut refused because it belongs to a component | delete, still armed |

Peter wrote "component". This applies it to **everything the delete tool removes**, because
the hazard is identical for a wire and a cut, and a rule that disarms after a part but not
after a wire is one nobody could predict from having seen it work once.

## Where the rule lives

`src/render/keys.js`, beside `TOOL_KEYS`, for the reason that file already states — *"A map
rather than a switch in the editor, so node can check…"*.

```js
export const TOOL_AFTER_DELETE = 'select';
export function toolAfterDelete(removed) { return removed ? TOOL_AFTER_DELETE : null; }
```

**`TOOL_AFTER_ESCAPE` moves here too.** It currently lives in `src/render/colours.js`, which
is a file about colours; it is the same kind of rule as the new one, and two "which tool
comes next" constants in two different files is the shape this project has paid for twice
already. Moving it changes no behaviour and the existing checks cover it.

## Files

| file | change |
|---|---|
| `src/render/keys.js` | `TOOL_AFTER_DELETE`, `toolAfterDelete()`, and `TOOL_AFTER_ESCAPE` moved in |
| `src/render/colours.js` | `TOOL_AFTER_ESCAPE` leaves |
| `public/app.js` | the three successful delete branches disarm; the import moves |

## Explicitly NOT changed

- What the delete tool can delete, and the refusal on a cut owned by a component.
- The Delete and Backspace keys, which arm the tool.
- Undo, which still takes any of this back.
- Escape's behaviour.

## What a green run means

`tests/render/test_keys.mjs` reports `N/N checks passed`:

- `toolAfterDelete(true)` is `select` and `toolAfterDelete(false)` is null — nothing to change;
- both `TOOL_AFTER_DELETE` and `TOOL_AFTER_ESCAPE` name a tool the toolbar can actually arm,
  checked against the tool list rather than against a literal;
- they are exported from the same module.

Plus, in a real browser: delete a part, a wire and a cut, and the toolbar shows **Select** each
time; click empty board with delete armed and it stays armed.
