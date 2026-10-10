# BUG — every Library item draws the stand-in, not its footprint

status: done
area: editor-ui

Peter, 2026-10-11: *"seems that the images for the library items in the left drawer are not
displaying on the web console"*

Reproduced on a scratch board: all 16 visible items — and 32 counting the collapsed groups —
draw the same two-pad stand-in icon. **I caused it.** `47fa0e8` lifted the component editor
into its own module and took `scrapProjectFor` with it, and `libraryThumb` in `app.js` still
calls it. The call throws `ReferenceError`, and the thumbnail's own

```js
} catch { svg = ''; }
```

turns that into the stand-in. Nothing reaches the console, so the drawer looks deliberate.

The helper's own comment said what the move broke: *"Shared by this preview and the Library's
footprints, so the two can never disagree about how a part is framed."* It was shared, and I
put it inside one of the two sharers.

## Why nothing caught it

`tests/browser/test_library_layout.mjs` asked whether each item **has an `<svg>`**. The
stand-in is an `<svg>`. A present element is not a drawn footprint — the same lesson as the
rendered-versus-present one in `/playwright`.

## The fix

- `scrapProjectFor` moves to **`src/model/scrap.js`**, which is where a pure function shared by
  two screens belongs: no DOM, no library import beyond `getPart`, so node can check it.
  `app.js` and `component-editor.js` both import it from there.
- **The thumbnail stops swallowing the reason.** The stand-in stays — point to point really has
  no footprint — but anything unexpected is reported once to the console with the part's id,
  so the next time this breaks it says so instead of looking normal.

## Files

| file | change |
|---|---|
| `src/model/scrap.js` | new: the scrap board a single part is framed on |
| `public/app.js` | imports it; the thumbnail reports what it could not draw |
| `public/component-editor.js` | imports it instead of defining it |

## What a green run means

`tests/browser/test_library_layout.mjs`:

- no non-wire item draws the stand-in — the measurement that was red for 32 items;
- the footprints differ from one another: more than five distinct drawings in the drawer.
