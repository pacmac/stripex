# BUG — the library is similar text throughout, and one item cannot be told from the next

status: in progress
area: editor-ui

Peter, 2026-09-17: *"I do not like the layout of the library. there is a lot of similar
style text and it's impossible to distinguish one lib group item from another."*

He was shown two mockups built from the real renderer: **A**, a list with a footprint
beside each name, and **B**, tiles two across. His answer: *"both layouts are OK, ideally
there would be a little icon top right of the lib header that allows list to be shown as
tiled or list ?"*

## What is wrong, as seen on screen

| | |
|---|---|
| group headings are weaker than the items under them | 10.5 px grey capitals over 13 px dark text, with no space to say where a group starts |
| items have no edges | "Capacitor (ceramic)" and "Capacitor (electrolytic)" read as one block |
| nothing is visual | it is a palette for a drawing tool, and not one part shows its shape |
| **devices are styled apart** | the item style targets `button[data-part]` only; a device is `button[data-device]`, so the XIAO and the TMC2209 fall through to the default bordered, centred button — two styles for one kind of thing |
| nothing collapses | Connectors is sixteen items and pushes Surface mount off the bottom |

## The change

**Two views of one list, with a toggle in the card header.**

- **List:** a footprint beside the name, with a quiet second line (pin count, "copper side",
  or the device's base package and an unverified-pins warning).
- **Tiles:** two across, with the footprint above the name.
- **The toggle** is an icon at the top right of the Library header. It is visible only while
  the card is open, because it controls a body you cannot otherwise see. It is NOT inside
  the header's `<button>`: a button inside a button is invalid markup and swallows the
  click. The header becomes a row holding the existing button and a tools slot.
- **The choice is remembered per viewer** in `localStorage`, wrapped in try/catch, with the
  page correct without it. This is a view preference, like the layers. No board data goes
  anywhere near the browser store.

**Groups that read as groups.** Each group gets a rule above, more space before than after,
a bold heading and its item count, and a click on the heading collapses it. While a search
is typed, collapsed groups still show their matches, because a search that hides its own
results is a search that lies.

**One item style for parts and devices.** Both are drawn by the same markup and the same
CSS.

**Footprints from the real renderer.** Each thumbnail is `renderBoard` on a scrap of board
sized to the part's pins plus one strip, cropped with `drawingExtentMm`. No DOM measurement
is needed, so thumbnails can be cached by part and theme and do not re-render on every
repaint. A copper-side part is drawn from the underside, which is the view it is built
from. A wire-only part (point to point) has no footprint and gets a drawn stand-in. The
preview on the Components screen already derives its scrap of board the same way, so that
code becomes one helper both use.

A part's parameters (lead pitch, pins per side) still open directly beneath it in the list.
In tiles they open beneath that group's grid, full width, because a tile is too narrow to
hold an input.

## Known dependency, stated rather than buried

The thumbnails use each part's default rotation, which today is 0 for everything except the
wire link: registered as `a-part-does-not-say-which-way-its-pins-cross-the-strips`. Until
that is fixed, a DIP thumbnail shows its pins along the strips, exactly as it places. The
thumbnail follows the fix automatically.

## Files

| file | change |
|---|---|
| `public/app.js` | header tools slot and toggle; the two views; collapsible groups; thumbnails; the shared scrap-of-board helper |
| `public/style.css` | group, list-row and tile styles; one style for parts and devices |

## Explicitly NOT changed

- `src/render/svg.js`. The thumbnails are its existing output, cropped.
- Item names, and folding the JST family into one entry. Both were offered; neither was
  asked for.
- The rotation defect above has its own entry.

## What a green run means

`tests/browser/test_library_layout.mjs`, in a real browser:

- an open Library card shows a view toggle at its top right, **not inside** the header
  button; clicking it switches between list and tiles, and the choice survives a reload;
- every item except a wire-only part carries a footprint `svg`, in both views;
- a device and a part are laid out identically: same display, text alignment and border;
- every group has a heading carrying its item count, a click collapses it, and a search
  still shows matches inside a collapsed group;
- in tiles, choosing a part with parameters still shows its inputs;
- no page errors in either theme.
