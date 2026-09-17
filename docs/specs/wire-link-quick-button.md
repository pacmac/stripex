# GAP — there is no toolbar button for a wire link beside the pen wire

status: in progress
area: editor-ui

Peter, 2026-09-17: *"and also, there needs to be a quick action button for Wire Link, next to
pen link."*

## What is wrong

The toolbar's "add to the board" group has Place and Pen wire. A pen wire is one click away;
a wire link, used for every power rail, means opening the Library, finding Wiring and
choosing it.

## The change

A **Wire link** button directly after the pen wire button, in the same group.

- It arms **Place with the wire link**, exactly as choosing it in the Library does: the part,
  no device, its derived rotation (90, across the strips) and its length setting, which
  opens in the Library card as it does now.
- It is marked with `data-quick-part="wire-link"`, not `data-part`, so nothing that looks for
  Library items can mistake the toolbar for one.
- **It lights when a wire link is armed, and Place does not.** Place lights for any other
  part. Otherwise the toolbar would show two lit buttons for one armed tool, which is the
  confusion the two cut buttons were already fixed for.
- Choosing the wire link in the Library lights the toolbar button too, since it is the same
  armed state.

## Files

| file | change |
|---|---|
| `public/index.html` | the button and its icon |
| `public/app.js` | arming the part from the button; which button lights |

## What a green run means

`tests/browser/test_wire_link_button.mjs`:

- a wire link button sits immediately after the pen wire button;
- clicking it lights it, leaves Place unlit, and marks the wire link in the Library;
- clicking a hole then places a `wire-link` at rot 90;
- clicking the pen wire button unlights it.
