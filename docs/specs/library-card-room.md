# SPEC — the library must not hide parts it is holding

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  public/style.css:  bede907ee580cf660d9382dc2856304029fc9854ca94c049362d19ee1b596d95

Peter, 2026-08-30: *"you seem to have removed DIP packages from the dashboard ?"*

## Nothing was removed. That is the point

Measured in Chromium at 1600×1000: the library holds all fourteen parts —
`point-to-point, wire-link, res-axial, cap-ceramic, cap-electro, diode, led, to92, to220,`
**`dip`**`, smt-0603, smt-0603-cap, header, mount-hole`. The card body is **520 px tall
holding 906 px of content**, `overflow-y: auto`, and the scrollbar measures **0 px wide**
because Chromium gives an overlay scrollbar to a region the pointer is not over.

So 386 px of the library — five of its fourteen parts — is off the bottom with no mark of
any kind saying so. And the cut lands directly under the **ICS AND SOCKETS** heading, so the
one visible clue points the wrong way: a category header with nothing beneath it reads as an
empty category, not as a clipped one.

A user cannot tell "not in the library" from "below the fold" here, and read it as the parts
having been deleted. That is the defect: not the scrolling, the **silence**.

## Where 520 px comes from

```css
.card-body { max-height: 52vh; overflow-y: auto; }
```

The comment above it is right about why it exists — *"Without this the Library's list pushes
the other three headers off the bottom of the panel, so you cannot see that Cutting, Layers
and Board exist"*. Keeping the other headers reachable is correct. **52vh is the wrong way to
do it**: it is a guess at how much room three closed headers need, it does not change when a
card is added, and at 1000 px it throws away 180 px of panel that nothing else was using.

## The fix

**Ask the layout, do not guess.** The left panel becomes a flex column; the open card takes
whatever is left after the other headers have taken theirs.

```css
.panel.left  { display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.card        { flex: 0 0 auto; }
.card.is-open{ flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
.card-body   { flex: 1 1 auto; min-height: 0; overflow-y: auto; }   /* no max-height */
```

The closed headers keep their exact height because a closed card has no body; the open one
gets the remainder. Add a fifth card and the arithmetic still holds, which a `vh` fraction
cannot promise.

`overflow: hidden` on the panel is what makes the card the scroller rather than the panel.

## And when it still does not fit, say so

At a short viewport the list will overflow anyway, so the affordance matters on its own.

**The scrollbar cannot carry it.** Measured in Chromium 150 at 1440×720, with 422 px of
content below the fold, the scrollbar is **0 px wide** — and it stays 0 px under
`scrollbar-width: auto`, under `scrollbar-width: thin` with a colour, and under
`::-webkit-scrollbar { width: 8px }`. This build has overlay scrollbars and no CSS turns
them off. A fix that depended on one would have been shipped untested and silently absent.

So the affordance is a **scroll shadow**, painted by the element itself:

```css
background-image:
  linear-gradient(var(--panel), transparent),                  /* cover, top    */
  linear-gradient(transparent, var(--panel)),                  /* cover, bottom */
  radial-gradient(farthest-side at 50% 0,   var(--scroll-shade), transparent),
  radial-gradient(farthest-side at 50% 100%, var(--scroll-shade), transparent);
background-attachment: local, local, scroll, scroll;
```

The two covers are in the panel colour and **scroll with the content** (`local`); the two
shades stay pinned to the edges (`scroll`). At the top of the list the cover sits over the
top shade and hides it; scroll and the cover moves away, uncovering it. The fade therefore
appears exactly when there is something past that edge and goes when there is not — with no
JS, no scroll handler, and nothing to keep in step.

`--scroll-shade` is a token because it must **invert** for the dark theme: black on a
`#1e1a13` panel is no shadow at all, there being nothing darker to go to.

The scrollbar rules are kept for browsers that honour them, but nothing depends on them.

The same rules go on `.panel`, because the right-hand panel scrolls the same way and would
tell the same lie about the Nets list.

## Files

| file | change |
|---|---|
| `public/style.css` | the left panel is a flex column, the open card fills it, `max-height: 52vh` goes, and scrollbars are made visible |

## Explicitly NOT changed

- Which parts are in the library, and their categories. Nothing was missing.
- The accordion behaviour — one card open, a tool opening its own card.
- `.card-head`'s `position: sticky`, now a no-op since the head sits outside the scroller.
  Removing it is a tidy, not part of this fix.

## What a green run means, and what it does not

`tests/render/test_left_panel_room.mjs` reports `N/N checks passed`: the stylesheet declares
no fixed cap on an open card body; the left panel is a flex column; the open card grows and
its body is the scroller with `min-height: 0`; and a scrollbar width is declared for both the
card bodies and the panels.

**This check reads the stylesheet, not the rendered layout** — the repo's harness is node,
with no browser. It can prove the rules are declared; it cannot prove the pixels. The pixels
are measured in Chromium and reported with numbers: every part in the library reachable at
1600×1000 without scrolling, and a scrollbar of non-zero width when it is not.

The missing browser harness is a real gap and is registered separately as
`nothing-measures-the-rendered-layout`; it is not this fix's job.
