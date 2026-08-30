# SPEC — the mouse obeys the same rules as the API

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  public/app.js:     15d4abd0a27af968876d977f7b19e67531c2c1eba220e0157a632a2cc9a1d8ab
  src/model/ops.js:  8229341921802a10f5b9211d2fbf39280889abd1e0b81a6e3c53e83c483c35c1

## What is wrong

`src/model/ops.js` refuses a pen wire into an occupied hole and a pen wire on a power net,
naming the rule. The editor does not go anywhere near it:

```js
// public/app.js, inside onBoardClick()
const wire = { ref: nextWireRef(p), from: state.wireStart, to: hole };
p.wires.push(wire);
```

So **the same wire is refused over HTTP and accepted by clicking.** One board, two sets of
rules, and the looser one is the one a person uses.

That asymmetry is not hypothetical. It is how nine wire ends came to sit on top of pins on
Peter's rotator board: I had the rules, wrote them into a spec, and then built the board
through a path that did not consult them.

## The change

Every mutation in the editor goes through `ops.js`. There are seven:

| in `onBoardClick` | becomes |
|---|---|
| `p.placements.push(pl)` | `addPart` / `placementFor` via `addPart({device})` |
| `p.wires.push(wire)` | `addWire` |
| `p.breaks.push(...)` / filter | `setBreak` / `clearBreak` |
| `p.placements.filter(...)` | `removePart` |
| `p.wires.filter(...)` | `removeWire` |
| `movePlacementByPin(...)` | `movePart` |
| the size inputs | unchanged — a board resize is not an op |

**A refusal is shown, not swallowed.** The status line says what the rule was, in the words
`ops.js` already produces: *"(4,2) already has R1.1 in it — a pen wire goes hole to hole"*.
Silently doing nothing would be worse than the old behaviour, because the old behaviour at
least drew something.

## The rule that is NOT enforced on the mouse

`penWiresSignalsOnly` refuses a pen wire touching a power net. Peter's own board has pen wires
he drew before the rule existed, and a rule that makes an existing board unusable is a rule
nobody keeps. So:

- **`addWire` still refuses it** — the API is where a board is built programmatically, and a
  planner must be held to it.
- **the editor warns and allows.** The finding appears in Checks, from `checkRules`, where he
  can see it and decide.

That split is deliberate and is the honest reading of "power lines must be wire links": it is a
design preference, not an electrical impossibility, and the person at the bench outranks it.

## Files

| file | change |
|---|---|
| `public/app.js` | every mutation through `ops.js`; refusals shown |
| `src/model/ops.js` | `addWire` takes an option to warn rather than refuse |

## Explicitly NOT changed

- The rules themselves, or their defaults.
- The API's behaviour: it still refuses.
- Undo, which snapshots whatever the operation returned.

## What a green run means

`tests/browser/test_editor_rules.mjs` reports `N/N checks passed`, in a real browser because
the point is what a click does:

- **drawing a pen wire onto a pin is refused, and the status line says why** — naming the pin
  in the way and the rule;
- the board is unchanged after that refusal;
- drawing one between two free holes still works;
- a pen wire onto a power net is **allowed**, and a finding appears in Checks saying so;
- placing, deleting, cutting and moving all still work, because they now go through the same
  code the API uses.

## What the last check found, which was not a defect

Arming Delete deleted the part that had just been *placed*, not the one clicked afterwards —
because placing selects what it placed, and a tool acts on an existing selection. That is
verb-after-noun working exactly as asked for. The check now clears the selection first, so it
measures the click rather than the arming, and asserts that only R1 went.
