# SPEC — a tool acts on what you already picked

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  public/app.js:  81dfa2ba92eb346101b6ed6ef3397bf5aeef93ceda231a6eb91dc06a0dddcea1

A note on the register, because it caught something: the entry first named the browser suite
among its files. Closure asks whether a named file changed between the red run and the green
one — and a **check must not change after its own trial**, so naming it made closure
impossible. Corrected by the documented order: revert the fix, amend the file list, try (red),
restore, prove (green).

Peter, 2026-08-30: *"sometimes I will select a component then press the move/delete etc etc
button, but sometimes I will select the move/delete etc and then select the component. only
the latter is now supported."*

## What is wrong

Every tool is **verb then noun**: arm the tool, then click the thing. Select a resistor and
press Delete and nothing happens — the tool arms and waits for a click, and the part you are
looking at, which is lit and named in the Focus tab, is ignored.

**Rotate is the exception.** It acts on the selection, which is exactly why the asymmetry is
noticeable: one button on that bar does what you expect and the two beside it do not.

## Which tools, and which not

The distinction is not "make every tool work both ways". It is that **a tool operating on an
existing object should accept that object from the selection**, and a tool that creates
something at a hole cannot, because a selection is not a hole.

| tool | with something selected |
|---|---|
| delete | delete it, then disarm as `delete-disarms.md` says |
| move | arm the move on it, held by **pin 1** |
| rotate | already does this |
| place, wire, break | unchanged — they need a hole, not a selection |

**Pin 1 for move**, because a move needs a handle and pin 1 is the one every part has, is
marked square on the board, and is where a person points when they say "this part". Picking
another pin first still works and still wins: `move` already re-arms on a pin click.

## What it must not do

- **Not on arming alone when nothing is selected.** Pressing Delete with an empty selection
  arms the tool as it always did.
- **Not for a net.** A net is not an object you can delete or move; selecting a strip and
  pressing Delete must not do something surprising to the copper. Only a **part** or a **pen
  wire** counts.
- **Not silently.** Deleting from the toolbar says what went, in the status line, exactly as
  deleting by clicking does.

## Files

| file | change |
|---|---|
| `public/app.js` | `setTool` consults the selection for `delete` and `move` |

## Explicitly NOT changed

- Verb-then-noun, which keeps working for every tool.
- The keyboard shortcuts, which arm tools and now inherit this through `setTool`.
- Undo, which takes any of it back.
- `delete-disarms.md`: a delete that removed something still returns to Select.

## What a green run means

`tests/browser/test_layout.mjs` reports `N/N checks passed`:

- with a **part** selected, pressing Delete removes that part and the tool returns to Select;
- with a **pen wire** selected, pressing Delete removes the wire;
- with a part selected, pressing Move **arms the move on it** — the move handle is drawn on
  its pin 1 — rather than waiting for a pin click;
- with a **net** selected, pressing Delete deletes nothing and arms the tool;
- with **nothing** selected, pressing Delete arms the tool and changes no data;
- clicking a part with the delete tool armed still deletes it, which is the path that already
  worked.
