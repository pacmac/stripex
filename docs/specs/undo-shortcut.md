# SPEC — Ctrl+Z and Ctrl+Shift+Z, and who is allowed to swallow them

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/keys.js:  3d228b1fcd21d573f2cceb342f5373a99fb8a1fe4827a6e8eb15bbac790920f7
  public/app.js:       3b6916eb3c2faabc9d19a484b948ede438962f7532f526c789ad8c28dceb626e

Peter, 2026-08-30: *"undo should be linked to ctrl-z and redo to shift-ctrl-z"*

## It is already linked, and it already works

Measured in Chromium before changing anything, on `public/app.js:1401`:

| | result |
|---|---|
| place R1, place R2, **Ctrl+Z** | R2 removed, "undone" |
| **Ctrl+Shift+Z** | R2 back, "redone" |
| type in a net-name field, **Ctrl+Z** | the FIELD's text is undone, the board untouched — correct |
| Ctrl+Z with the board focused | undoes |

The reason it looked broken is the defect fixed one commit ago in `undo-off-by-one.md`: the
stack held post-states, so the first press of Ctrl+Z did nothing whatever it was bound to.
Binding it again would have "fixed" nothing and hidden that.

## What IS wrong

```js
if (e.target.matches('input, select, textarea')) return;   // before the Ctrl+Z branch
```

Measured: with the **View dropdown focused**, Ctrl+Z does nothing at all. Three placements
stay three placements.

A field is allowed to swallow Ctrl+Z when it has an undo of its own — a text box does, and its
own undo is what you want while you are typing in it. **A `<select>` has none.** It swallows
the shortcut and offers nothing in its place, so the keystroke is simply lost, and the way to
get to that state is ordinary: change the view, then decide to undo something.

The same is true of a checkbox, a radio, a colour input and a range — all of which this editor
has, in the Layers card and the net colour swatches.

## The fix

Two pure functions in `src/render/keys.js`, beside `TOOL_KEYS`, for the reason that file
already gives: *"A map rather than a switch in the editor, so node can check…"*. The shortcut
had no such mapping, so nothing could check it and the hole above was invisible.

```js
historyActionForKey(evt) -> 'undo' | 'redo' | null
ownsUndo(target)         -> does this element have an undo of its own?
```

- `historyActionForKey` accepts **Ctrl or Cmd**, `z` in either case, and reads Shift as redo.
  Cmd costs nothing and is what the same keyboard would send on a Mac.
- `ownsUndo` is true for a textarea, a contenteditable, and an `input` whose type holds
  **text** — the default, `text`, `search`, `url`, `tel`, `email`, `password`, `number`. False
  for `select`, `checkbox`, `radio`, `range`, `color`, `file`, `button` and everything else.

`number` stays with the text group: it holds an editable string, and the span and width fields
are numbers you type into.

The editor checks the shortcut **before** the general `input, select, textarea` guard, and
guards it with `ownsUndo` instead. The other shortcuts — `v p b w m x r`, Escape, Delete —
keep the guard they have; a letter key while a dropdown is focused is a different question and
is not this fix's to answer.

## Files

| file | change |
|---|---|
| `src/render/keys.js` | `historyActionForKey()`, `ownsUndo()` |
| `public/app.js` | the keydown handler uses them |

## Explicitly NOT changed

- `TOOL_KEYS` and every tool shortcut.
- Ctrl+Y as an alternative redo. Peter named Ctrl+Shift+Z; adding a second binding nobody
  asked for is how a keymap becomes undocumented.
- The Undo and Redo buttons.

## What a green run means

`tests/render/test_keys.mjs` reports `N/N checks passed`:

- Ctrl+Z is undo and Ctrl+Shift+Z is redo, with Cmd accepted for Ctrl and either case of `z`;
- a bare `z`, and Ctrl with any other key, are neither;
- **a `select` does not own the shortcut** — the measured defect — nor does a checkbox, a
  radio, a colour input or a range;
- a text input, a number input, a textarea and a contenteditable do own it;
- an element that is not a field at all does not own it.

Plus, in a real browser: Ctrl+Z undoing with the dropdown focused, and still NOT undoing the
board while typing in a net-name field.
