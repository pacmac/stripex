# SPEC — ask a stored board what it connects, what it wastes, and change its size

status: draft
area: storage-api
source_hash: (set in Phase 4)

Three gaps, all found by building two real boards through the API rather than by reading it.
None is a missing capability — the model can already answer all three. They are gaps between
what the model knows and what a caller holding a slug can ask.

## 1. There is no way to ask what a STORED board connects

`POST /api/check` answers `nets`, `findings` and `runList` — and takes a whole project in the
body. A caller holding only a slug has to `GET` the board and post it back to ask what is
connected to what.

So **the one verification step that matters has no endpoint.** Deriving the nets from the
copper is the check that caught a reversed LED on a board that passed everything else, and I
imported `src/model/views.js` into node by hand every single time I needed it.

`netsFor(project).nets` already carries each net's `pins` with `ref` and `pin`. Nothing needs
computing that is not computed already.

**`GET /api/boards/:slug/check`** → `{version, nets, findings, runList}`.

Its `findings` are the **merged** set the editor shows — DRC, `checkRules`, disabled-rule
notes, and netlist findings when the board carries a netlist. A caller asking "is this board
all right" means all of it, and the body-form `/api/check` stays as it is because changing
what an existing endpoint returns is a different decision from adding one.

## 2. A board cannot be resized

There is no op and no endpoint for `board.cols` / `board.rows`. Making the 555 narrower meant
`DELETE` and rebuild — **three times**, twenty to fourteen to twelve to eleven columns, about
thirty ops re-sent each round, losing the board's identity and history every time.

**`setBoardSize`**, an op like any other, so it goes through `applyOps` and the same version
guard with no new route.

**It is refused, naming what would fall off**, when any pin, wire end, cut or net label would
land outside the new outline. Silently truncating a board is the one behaviour worse than
refusing: a part that half falls off the edge is a board that still looks plausible.

## 3. The tightening pass has no query behind it

Finding wasted columns and rows means listing what occupies each. I wrote that by hand in node
three times in one session — the same shape as `freeHolesOn`, which its own comment records as
*"written three times in three scratch scripts and wrong twice"*. Peter spotted waste I had
missed **twice**, partly because the answer was not on screen anywhere.

**`usageOf(project)` in `src/model/views.js`**, served as **`GET /api/boards/:slug/usage`**:

```
{ columns: [{ col, refs: [...] }],
  rows:    [{ row, refs: [...], segments: [{ x0, x1, net, refs }] }],
  emptyColumns: [n], emptyRows: [n], emptySegments: [{ row, x0, x1 }] }
```

In the model rather than the route, so it is testable without HTTP and available to the editor
later — the same reason the four derived views live there.

## Files

| file | change |
|---|---|
| `src/model/views.js` | `usageOf` |
| `src/model/ops.js` | `setBoardSize`, registered in `OPS` |
| `src/server/index.js` | `GET /api/boards/:slug/check`, `GET /api/boards/:slug/usage` |

## Explicitly NOT changed

- `POST /api/check` and `POST /api/render`, which take a project body and keep doing so.
- The rules, the DRC, and what any of them report.
- `freeHolesOn`, which already answers its own narrower question.

## What a green run means

`tests/model/test_resize.mjs` and `tests/server/test_board_queries.mjs` report `N/N`:

- `GET /api/boards/:slug/check` returns the nets **with their pins**, so a caller can read the
  circuit without loading the model, and 404s for a board that is not there;
- its findings include a rule finding, not only DRC ones;
- `GET /api/boards/:slug/usage` names the parts in each column and row, and lists the empty
  ones — **on a board with a known empty column, that column is in `emptyColumns`**;
- and a strip segment carrying nothing is in `emptySegments`, which is the "unused strip"
  question asked directly;
- `setBoardSize` shrinks a board that fits, and the derived nets are unchanged by it;
- **it is refused, naming the part, when a pin would fall off** — and refused for a wire end,
  a cut and a label too;
- growing a board is never refused;
- and a resize goes through `applyOps` like any other op, all or nothing.
