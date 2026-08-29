# SPEC — SVG board editor

status: implemented, entry CLOSED
area: editor-ui, storage-api
source_hash:
  src/render/svg.js:    dfcaf918cee8ae25ee6e4235b0ef9eda1fffd5f9f942d22f5fc6dcf9d5742aae
  src/server/index.js:  a7dc690f291d9a18104c4b4da98dc2db7a6368541d0df4838148b440f6a301c9
  public/index.html:    d404772d930f3726569f3fbfcca638dfeb1d259e8beed29f4c72a7ab98b1117c
  public/style.css:     864f1c6f88fb848f5f80824e5f37b24544593b15b4e47493f0dab22b599c559f
  public/app.js:        9a71577626bdf13f571d4aebf0b07a0bed74c14846e91b4bdc880cae287eb6ea

## What the browser actually did

Driven in Chromium at 1920×1080, 1600×1000, 1440×900, 1280×800 and 1024×768, in both
themes and both views. Red 0/20 → green 20/20, and the register closed the entry.

- Placed a DIP-14 and an axial resistor by clicking holes; both landed where clicked.
- Cut row 6 between holes 14 and 15 with the break tool; the copper count went 20 → 21
  and the marker landed on the boundary, not on a hole.
- Drew a pen wire (2,8) → (18,14); it appeared in the drawing, in the net list and in the
  run list, labelled W1.
- Underside view mirrored correctly — the break marker moved from x≈865 to x≈655 on a
  board spanning 225..1295, which is the mirror of the same gap.
- No console errors.

### Defects found by looking, and fixed

- **20 rows of "carries nothing"** buried the errors on a fresh board. Dead-copper notes
  now collapse into one foldable summary line.
- **The page scrolled sideways at 1280×800.** The toolbar now scrolls inside itself; a
  horizontally scrolling page would move the board out from under the pointer mid-click.
- **favicon 404** on every load. Now an inline SVG.

### A DIP always shows seven errors, and that is correct

A DIP straddling the strips puts pin *n* and its opposite pin on the same row, hence the
same strip. On real stripboard you must cut the strips under an IC, and until you do, the
part is shorted. The DRC reporting seven errors for a 14-pin socket is the tool telling
the truth.

An earlier regression check in the connectivity task appeared to show a rotated DIP with
no shorts. That check was wrong: on the 12×8 board it used, the second pin row fell at
column −1, off the board, and off-board pins are excluded from the short test. It proved
less than it claimed.

## The split that makes this testable

The renderer is a **pure function** that takes a project and returns an SVG string:

```js
renderBoard(project, { view, theme, highlightNet, findings }) -> "<svg …>"
```

It lives in `src/render/svg.js`, imports nothing from the DOM, and is imported unchanged
by three callers: the browser editor, the exporter, and the tests. This is the whole
reason the editor can be checked in node without a headless browser — a render that only
exists as DOM mutations can only be checked by driving a browser, and a check that needs a
browser is a check that gets skipped.

The browser module sets the SVG into the page and attaches listeners to it. It owns
state, tools, undo and hit-testing; it owns no drawing.

## Views

| view | what it draws |
|---|---|
| `top` | component side: copper shown faintly beneath, parts and refs on top |
| `underside` | mirrored in X, copper solid, breaks prominent, no part bodies |

`underside` is what you solder from, and it is mirrored because the board is physically
turned over. Mirroring happens **only here**; nothing in the model or the geometry module
is mirrored.

## Layers, in paint order

1. board substrate
2. copper strips — one rect per segment, `TRACK_W_MM` wide, centred on the row
3. break markers — drawn in the gap between hole x and x+1
4. holes
5. pen wires — insulated, so they may cross; drawn as lines with a ref label
6. component bodies and leads
7. refs and values
8. DRC markers — a ring on each hole named by an error

Every element carries `data-kind` and `data-ref` (or `data-hole="col,row"`), which is how
the browser hit-tests: one delegated listener on the SVG root reading `data-*` off
`event.target`, rather than a hit-test geometry engine duplicating the renderer's layout.

## Tools

| tool | key | behaviour |
|---|---|---|
| select | `V` | click to select, drag a placement or wire to move it |
| place | `P` | palette part follows the cursor; click to drop; `R` rotates |
| break | `B` | click a gap between two holes to cut or uncut it |
| wire | `W` | click a hole, click a second hole, wire created with the next free ref |
| delete | `X` | click to remove a placement, wire or break |

`Esc` cancels an in-progress placement or wire. `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo
over a snapshot stack — the project object is small and JSON-cloneable, so snapshots are
correct by construction where a command/inverse-command stack would need every tool to get
its inverse right.

The wire tool is the reason this project exists in the form it does: Peter builds with a
wiring pen, so drawing a wire must be two clicks and nothing else, and every wire must
show its ref on the board and in the run list.

## Panels

- **Palette** — parts from `partList()`, with a span control for parametric ones.
- **Inspector** — the selection's ref, value, span, rotation; editable.
- **Nets** — one row per net, hovering highlights every segment and pin on it.
- **Findings** — DRC output, errors first; clicking one selects and scrolls to the holes.
- **Run list** — every wire as `W1  (2,0) → (9,6)`, which is what the board is built from.

## Server

`src/server/index.js`, Express 5:

| route | does |
|---|---|
| `GET /` | the editor page |
| `GET /src/**`, `GET /public/**` | static ES modules, served so the browser imports the same files node does |
| `GET /api/parts` | `partList()` |
| `GET /api/projects` | list saved projects |
| `GET /api/projects/:id` | one project |
| `POST /api/projects` | create; validates and rejects with the problem list |
| `PUT /api/projects/:id` | update; same validation |
| `DELETE /api/projects/:id` | remove |

Storage is deferred to the storage-api task; v1 of this task serves parts and static
files, and the project routes come with the database. **Stated rather than hidden: until
that task lands, the editor keeps its project in `localStorage` and the save button says
so.**

## Theme

Light and dark, from `prefers-color-scheme` plus an explicit toggle stamping
`data-theme` on `<html>`. Copper must stay recognisably copper in both; the substrate and
the ink swap.

## Files this creates

| file | contains |
|---|---|
| `src/render/svg.js` | `renderBoard()` — pure, no DOM |
| `src/server/index.js` | the Express app |
| `public/index.html` | the page shell |
| `public/style.css` | both themes |
| `public/app.js` | state, tools, undo, event delegation |
| `tests/render/test_render.mjs` | the checks below |

## Explicitly NOT changed here

- `src/model/**`, `src/net/**`, `src/parts/**` — this task consumes them and must not
  alter them. If the editor needs a model change, that is a finding against the other
  task, not an edit here.
- Export to PNG/PDF, and the printed 1:1 drill sheet — the `export` area's task.
- The database — the `storage-api` task.

## What a green run means

`tests/render/test_render.mjs` reports `N/N checks passed`, where the checks include: one
copper rect per segment and the count changing when a break is added; a break marker drawn
between hole x and x+1 and not on a hole; a wire drawn as a line between the centres of
its two holes and carrying its ref; the underside view mirrored in X while the model is
untouched; `data-kind`/`data-ref` present on every interactive element; and DRC error
holes marked.

Plus, because a rendered element is not a verified one: the editor driven in a real
browser at the sizes actually used, in both themes, placing a part, cutting a break and
drawing a wire.
