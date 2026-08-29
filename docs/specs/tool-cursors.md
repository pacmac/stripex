# SPEC — the cursor says which tool is armed

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/cursors.js:  8a50b450e37dcb55f55de9ac552dfac888289979d1c8f417ad43a03bb0370283
  public/app.js:          aedf32440120b2e2071d7d1314c3c0bdf421fa9156692383a230c21150a73a34

## What the browser actually did

Red 0/6 → green 6/6, entry closed. 9 suites green. Computed style of `#boardWrap`, read in
Chromium after arming each tool:

| tool | cursor |
|---|---|
| select | `default` |
| place | `crosshair` |
| break | `crosshair` |
| wire | `crosshair` |
| delete | `default` |

Also checked, because each was a way to get it wrong:

- switching back to select returns to `default` — no stuck crosshair, which is what the
  `undefined` fallback check in the test exists to prevent
- arming place from the **palette** sets it too, not only from the toolbar button
- `#palette` and `.bar` still read `auto` — the crosshair is confined to the board

Peter, 2026-08-29: *"when selecting an item to place, the cursor should be a crosshairs"*

## The rule

The cursor over the board is decided by the armed tool, by one function:

```js
cursorFor(tool) -> a CSS cursor keyword
```

It lives in `src/render/cursors.js` so node can check the mapping and the browser can apply
it, rather than the mapping existing only as a CSS rule nothing verifies.

| tool | cursor | why |
|---|---|---|
| `place` | `crosshair` | asked for: you are aiming at a hole |
| `break` | `crosshair` | you are aiming at a gap or a hole |
| `wire` | `crosshair` | you are aiming at the hole an end lands in |
| `select` | `default` | you are pointing at an object, not a point |
| `delete` | `default` | likewise |
| anything else | `default` | an unknown tool must not leave a stuck cursor |

> Peter asked for the place tool. **Break and wire get it too**, because they are the same
> gesture — aim at an exact point on a 2.54 mm grid — and are if anything more precision-
> critical than dropping a part. Applying it to one of the three and not the others would
> be an inconsistency to report later rather than a scope boundary worth keeping. Say so
> here so it can be pushed back on.

Select and delete keep the ordinary pointer: they target *things*, and a crosshair implies
a coordinate.

## Where it applies

To the board only — `#boardWrap`. The palette, panels and toolbar keep their own cursors;
a crosshair over a list of parts would be nonsense.

Set from `setTool()`, which is the one place the armed tool changes, so the cursor cannot
drift out of step with the tool the toolbar shows as lit.

## Files

| file | change |
|---|---|
| `src/render/cursors.js` | **new** — `cursorFor()` |
| `public/app.js` | apply it in `setTool()` |

## Explicitly NOT changed

- Per-element cursors inside the SVG. A single cursor for the whole board is what makes
  the armed tool legible; changing it as you cross a part would say "this is clickable",
  which the tool already determines.
- The tool buttons themselves.

## What a green run means

`tests/render/test_cursors.mjs` reports `N/N checks passed`: place, break and wire are
`crosshair`; select and delete are not; an unknown or missing tool falls back to `default`
rather than to `undefined`, which would leave whatever cursor was set last.

Plus, because a rule in a file is not a cursor on a screen: the computed style of
`#boardWrap` read in a real browser after arming each tool.
