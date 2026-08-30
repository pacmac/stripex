# SPEC — a pen wire pad under a component can be clicked

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  c047133846fa48c91c1318674e23af29ba2bf6fbd50a1347b0c06d59b70d7ebf
  public/app.js:      3ccc162be0dd96845ff0a361b1c8689d66a5fb70adae50cae0ee229a68087c2a

One neighbouring check needed correcting rather than the code: the net-name plate asserts that
no wire covers it, and it found the wire by the prefix `data-kind="wire`, which now also
matches `wire-pad-hit`. That target is invisible and covers nothing, so the check now names the
three VISIBLE parts of a wire — and additionally asserts the target does sit on top, because
that is what makes it work.

Peter, 2026-08-30: *"I cannot select a point to point under a DIP / component."*

## What is wrong, and it is a bug this project has already fixed once

Pen wires are pass 5. Components are pass 6. So a part's body — translucent, but painted — is
the topmost element over any wire pad beneath it and takes the click. A pad under a DIP is
unreachable.

**This is exactly `break-hit-targets.md`, for a different object.** That spec says it in as
many words:

> A part is painted after the breaks, so its body was the topmost element over any cut beneath
> it and took the click. Every cut under a DIL was unreachable, which is exactly the set a DIL
> creates.

The fix there was an invisible hit target drawn after the components. Wire pads never got one,
and the reason is plain: when that was written, a pen wire under a chip was not something
anybody had drawn yet. Now the rotator board has four of them and two land under the XIAO's
footprint.

## The fix, which is the one that already exists

An invisible `wire-pad-hit` per pad, emitted in pass 8 beside the break targets, carrying the
same `data-ref` so the editor treats it as the wire it stands for.

**Sized like a pad, not like a body.** The break targets learned this the hard way: a generous
target measured 44% of a DIL's body and selecting the chip became a coin flip. A pad's own
radius is the right size — it is exactly the thing being aimed at.

**Emitted only when the wires layer is visible.** A hidden layer that still swallowed clicks is
the fault the layer feature exists to avoid, and the break targets already say so.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | a `wire-pad-hit` per pen-wire end, in pass 8 |
| `public/app.js` | the click handler treats it as its wire |

## Explicitly NOT changed

- The pads themselves, their size, colour and the ID inside them.
- The break targets.
- Which wins when both are under the pointer: precision decides, as it already does. A pad's
  target is 2.29 mm across against a body tens of millimetres wide.

## What a green run means

`tests/render/test_point_to_point.mjs` reports `N/N checks passed`:

- a `wire-pad-hit` exists for **every** pen-wire end;
- each is emitted **after** the component bodies, which is the whole point;
- each carries the wire's ref, so a click on it selects that wire;
- it is no larger than the pad it stands for, so it cannot swallow the package around it;
- and none is emitted when the wires layer is off.

Plus, in a real browser: a pen wire whose pad sits inside a DIP's footprint, selected by
clicking it.
