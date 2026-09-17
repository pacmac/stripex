# BUG — usage calls a column empty when a package is sitting on it

status: in progress
area: storage-api

Registered as `usage-calls-a-column-empty-when-a-package-is-sitting-on-it`: `usageOf` decides
`emptyColumns` purely by which holes are occupied, so the columns between a DIP's two pin
rows read as empty. On the SMT 555 it named column 7, the DIP's own spot-face column, which
cannot be removed. *"A true statement that invites a wrong conclusion, in the one query whose
whole job is to point at waste."*

## The change

A column or row that lies **inside any placement's pin rectangle** (wire links included,
since removing a column under a link breaks the link) is **covered**, not empty:

- `emptyColumns` / `emptyRows` list only columns and rows that no pin, wire end or body
  touches: the ones that can really go;
- `coveredColumns` / `coveredRows` list the others with nothing in their holes, each with
  the refs lying over it: `[{ col: 7, refs: ["U1"] }]`.

`GET /api/boards/:slug/usage` returns both, since it spreads `usageOf`.

## Files

| file | change |
|---|---|
| `src/model/views.js` | `usageOf` computes coverage |

## What a green run means

`tests/model/test_usage_covered.mjs`: on a board with a DIP across columns 5–8, columns 6 and
7 are not in `emptyColumns` and are in `coveredColumns` naming the DIP; a genuinely free column
is still empty; a link lying across columns covers them too.
