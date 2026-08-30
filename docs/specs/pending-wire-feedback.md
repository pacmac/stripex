# SPEC — a half-drawn wire has to be visible

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  028e34d3019f091a4e3a0b604a262a108f98332d21ba876b20c9e6468f77d9b1
  public/app.js:      379f2e1b408ac88d5dc10826adaa7a740c234a02f8a78f8d397a7b162d5736d6

## What the browser actually did

Red 3/10 → green 10/10, entry closed. 28 suites, 415 checks.

The same element census as the bug report, after the fix:

```
before first click   substrate 1, copper 20, hole 500
after  first click   substrate 1, copper 20, hole 500, wire-band 1, wire-start 1
```

- the marker sits on hole `4,4`, the one that was clicked
- moving the pointer to hole 12,9 moved the band's far end to `31.75, 24.10` while its
  start stayed on `11.43, 11.43`
- the second click completed wire `A` from (4,4) to (12,9), leaving pads and labels
- `Escape` on a half-drawn wire cleared the marker

Peter, 2026-08-30: *"no idea how to use your point to point. it always comprises of 2 holes
/ col/row values. I just selecetd p2p, selected a hole/pad and expected to see a symbol to
appear there, and prompt me for the second position, but nothing heppened"*

## Measured

Picking **Point to point** arms the wire tool correctly, and the first click *is* recorded —
the status line at the bottom of the window changes to `wire from (4,4) — click the other
end`.

But the board itself does not change **at all**. Counting every `data-kind` element before
and after that first click:

```
before  substrate 1, copper 20, hole 500
after   substrate 1, copper 20, hole 500
```

Identical. The only feedback is one line of text at the far edge of the screen, nowhere near
where you are looking or clicking.

The move tool already solves this — it draws a `move-anchor` ring on the pin it is holding.
The wire tool draws nothing, and the two were built a day apart without the second borrowing
from the first.

## The fix

**A start marker.** While a wire is half-drawn, the first hole gets a ring in the selection
colour, `data-kind="wire-start"`, drawn last so nothing covers it. Same idea as the move
anchor, and deliberately the same colour: both mean "the editor is holding this point and
waiting for you".

**A rubber band.** A line from that hole to the pointer, following the cursor until the
second click.

> The rubber band is updated by moving **one existing SVG element**, never by re-rendering.
> `renderBoard` builds the whole board as a string; doing that on every mousemove would
> rebuild five hundred holes to move one line. So the band is emitted once when the wire is
> pending and its `x2`/`y2` are set directly on mousemove.

It also answers the thing the status line cannot: the wire's colour comes from its length,
and with a band you can see the length changing as you move.

## Also: the prompt is in the wrong place

The status line is at the bottom edge. The start marker and band put the feedback where the
work is, which is the real fix — but the prompt text stays, because it is the only thing
that can say *"click the other end"* in words.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | `pendingWire` option: the start marker and the band element |
| `public/app.js` | pass it; move the band on mousemove; clear on Escape |

## Explicitly NOT changed

- The two-click gesture itself, which is right.
- The move tool's anchor, which already works.
- Full redraws on anything except a real edit.

## What a green run means

`tests/render/test_pending_wire.mjs` reports `N/N checks passed`: with no pending wire
nothing extra is drawn; with one, exactly one `wire-start` marker appears on the right hole
and exactly one `wire-band`; the marker is drawn after everything else so nothing covers it;
the band starts at the pending hole; the band is inert to pointer events, or it would eat
the second click; and none of it appears in the saved project, since a half-drawn wire is
not a wire.

Plus, in a real browser: pick Point to point, click one hole, and see the board change.
