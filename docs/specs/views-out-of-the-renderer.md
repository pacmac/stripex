# SPEC — what a net is belongs to the model, not the picture of it

status: implemented, entry CLOSED
area: board-model
source_hash:
  src/model/views.js:   14658c8d556ce4033547404ad862113cf8ccd08e30874a94c25589a9487449ce
  src/render/svg.js:    6717dda5bd03eb942ae588fe148c10980167bbd42a198fbefa068ec037c63b8c
  src/model/nets.js:    ead4ab3572e54b86c6b9431c449bbb492877a0bd14085b3933ca704aa3d25a8e
  src/server/index.js:  cff8d1b561129eb8c49d938d7a40ecdef59f20f1873d3bd63feabb001b2320c1
  public/app.js:        c7199ccb4b31092a8cc6faa7f08622d6cf3a071f40be310b9b634c05dc3fcbab

## What is wrong

`netsFor`, `findingsFor`, `runList` and `cutList` are exported from `src/render/svg.js`,
whose own first line says *"a project in, an SVG string out"*. They answer connectivity
questions and have nothing to do with drawing. So:

```js
// src/server/index.js
import { renderBoard, findingsFor, netsFor, runList } from '../render/svg.js';
```

The server asks the SVG module what the nets are. Six model test files do the same —
`tests/model/test_owned_breaks.mjs` imports the renderer to count nets. Anything that
wants to know what is connected to what has to load the renderer to find out.

That matters now rather than as tidiness, because the netlist builder Peter has asked for
is a program with no picture in it. Every consumer of connectivity that is forced through
`svg.js` is a consumer that cannot run without one.

**And `provideSegmentNet` is worse than untidy.** `src/model/nets.js` exports it, it writes
`globalThis.__stripexSegmentNet__`, and nothing anywhere reads that global. It is the scar
of an earlier attempt at this same separation: a module that could not import the renderer
so it arranged to be handed a function instead. The function is never supplied and the
global is never read, which means the workaround for a dependency that should not exist is
itself dead code that reads as a live mechanism.

## The change

A new module **`src/model/views.js`** — derived views of a project — holding the four
functions verbatim.

| was | becomes |
|---|---|
| `svg.js` exports `netsFor`/`findingsFor`/`runList`/`cutList` | `views.js` exports them; `svg.js` **imports** `netsFor` for its own highlight pass |
| `server/index.js` imports them from the renderer | imports them from `views.js`; still imports `renderBoard` from the renderer, which is what a renderer is for |
| `app.js` imports them from the renderer | same split |
| model and parts suites import the renderer to ask about nets | import `views.js` |
| `nets.js` exports `provideSegmentNet` | deleted, with the global |

**`svg.js` stops exporting them.** Re-exporting would leave the wrong import working, and
an available wrong path is the one that gets used — the same shape as the editor bypassing
`ops.js`, which is what put nine pen wires on pins.

## Explicitly NOT changed

- The functions themselves. This is a move, and the checks that pin their behaviour must
  pass byte-for-byte identical answers before and after.
- `renderBoard`, and the server's use of it to export an SVG.
- `THEMES`, the geometry constants, and everything else `svg.js` legitimately owns.
- `src/net/derive.js` and `src/net/drc.js`, which already live in the right place — `views.js`
  is the thin layer that hands them a project.

## What a green run means

`tests/model/test_views.mjs` reports `N/N checks passed`:

- **the four views live in `src/model/views.js`** and answer correctly — a resistor across two
  strips gives two nets, a link across them gives one;
- **`src/render/svg.js` exports none of them**, so there is no second way to ask;
- **nothing under `src/model`, `src/net` or `src/parts` imports the renderer at all**, and the
  server imports it only for `renderBoard`;
- `provideSegmentNet` and its global are gone from `src/model/nets.js`;
- and the board still draws: the full suite passes, including the browser checks, because a
  move that changes an answer is not a move.
