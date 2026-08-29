# SPEC — stripboard model and segment-derived connectivity

status: draft
area: board-model, connectivity
source_hash: (set in Phase 5)

## What this governs

The data model for a stripboard layout, and the derivation of electrical nets from it.
No rendering, no DOM, no HTTP. Everything here is pure functions over plain objects so
it can be tested without a browser and reused by the server, the editor and the
exporter alike.

## The physical facts this model encodes

Verified 2026-08-29 from supplier datasheets, not assumed:

| quantity | value |
|---|---|
| hole pitch | 2.54 mm (0.1 in) |
| hole diameter | 1.0 mm |
| copper track width | 2.0 mm |
| gap between tracks | 0.54 mm |
| board thickness | 1.6 mm |
| copper thickness | 35 µm |

Arithmetic check that these are one coherent set rather than three sources averaged:
`track 2.0 + gap 0.54 = 2.54 = pitch`. Exact.

Board outside dimensions for a `cols x rows` board are `cols * 2.54` by `rows * 2.54` mm,
which places the outer holes 1.27 mm from each edge — the standard half-pitch margin.

## The project object

```js
{
  schema: "stripex/1",
  name: "psu regulator",
  board: { cols: 25, rows: 20, pattern: "strip" },
  breaks: [ { row: 3, x: 7 } ],
  placements: [ /* see below */ ],
  wires: [ /* see below */ ]
}
```

`validateProject(project)` returns a list of problems and never throws. An empty list
means the object is safe to hand to `nets()` and `drc()`.

## Coordinates

- `col` indexes holes along **X**, `0 .. cols-1`.
- `row` indexes holes along **Y**, `0 .. rows-1`.
- **Strips run along X.** One strip per row, spanning the full board width. Board
  rotation is a view concern and must not reach this model.
- Origin is the top-left hole as seen **from the component side** (the plain side).
  The copper is on the far side. The exporter is responsible for mirroring; nothing in
  this model is mirrored.

## Breaks

> A break is a cut in the copper **between two adjacent holes**, never at a hole.

A break is `{row, x}` and means the copper between hole `x` and hole `x+1` of that row is
cut. Valid `x` is `0 .. cols-2`.

This convention is load-bearing. The commonest defect in stripboard software is an
off-by-half-a-hole break, which produces a drill list that is wrong by one hole and a
board that cannot work. Any function that consumes a break asserts `0 <= x <= cols-2`.

Segments in a row = breaks in that row + 1.

## Segments

`segments(board, breaks)` returns, for every row, the maximal runs of uncut copper:

```js
{ id: "s:<row>:<index>", row, x0, x1 }   // inclusive hole range
```

A row with no breaks yields one segment `x0=0, x1=cols-1`. Duplicate breaks at the same
`{row, x}` collapse to one — cutting the same gap twice is the same cut.

## Parts

A part definition is geometry only. It carries no value, no reference designator and no
placement.

```js
{
  id: "res-axial",
  name: "Resistor (axial)",
  kind: "component" | "link",       // "link" is the ONLY zero-ohm kind
  parametric: "span" | null,        // if set, `span` is supplied per placement
  defaultSpan: 4,                   // pin-to-pin, in holes
  minSpan: 2,
  pins: [                           // dx/dy in holes, relative to the placement anchor
    { name: "1", dx: 0,      dy: 0 },
    { name: "2", dx: "span", dy: 0 }
  ],
  body: { /* outline in hole units, for the renderer; ignored here */ }
}
```

`dx` or `dy` may be the literal string `"span"`, resolved per placement. `electrical`
defaults to `true`; a pin with `electrical: false` occupies its hole and joins no net
(mounting hole, TO-220 tab, deliberately unsoldered lead).

## Placements

```js
{ ref: "R1", part: "res-axial", span: 4,
  at: { col: 2, row: 3 }, rot: 0, value: "10k" }
```

`rot` is one of `0, 90, 180, 270`, applied about the anchor hole, clockwise when viewed
from the component side:

```
rot   0: ( dx,  dy)
rot  90: (-dy,  dx)
rot 180: (-dx, -dy)
rot 270: ( dy, -dx)
```

`resolvePins(placements, parts)` yields absolute pins:

```js
{ ref, pin, col, row, electrical, kind }
```

## Wires — the wiring pen, and why they are not placements

A bare **wire link** is a part: uninsulated, bent to a fixed span, running along one row
or one column. A **pen wire** (Verowire / wire-wrap pen) is insulated, runs point to point
between any two holes in any direction, and may cross other wires freely. The second
cannot be expressed as a placement with a span, so it is a first-class object:

```js
{ ref: "W1", from: { col: 2, row: 0 }, to: { col: 9, row: 6 } }
```

`ref` is the wire's index, and it is the point of the feature: the board gets built from a
printed **run list** — "W1: (2,0) to (9,6)" — rather than by reading the drawing and
guessing which line goes where. Refs are unique across wires and placements alike, and
`nextWireRef(project)` allocates the next free `W<n>`.

A wire is zero-ohm, so it is an edge in the net graph exactly as a link is. Both ends must
land on the board; neither end needs a component there.

> A wire end sharing a hole with a component lead is **normal** — the pen wire is soldered
> to the existing joint. `hole-collision` therefore counts component leads only and must
> never fire on a wire end. Getting this wrong would flag every correctly built board.

## Nets — and the rule that makes them correct

> Segments are **not** nets. Segments are the vertices of a graph whose edges are
> zero-ohm parts.

A resistor bridging two strips does not merge them; it is a component with impedance
sitting *between* two nets. Only a part with `kind: "link"` merges the segments its
pins land in.

```
vertices = segments
edges    = for each placement with kind "link", every pair of its electrical pins
         + for each wire, its two ends
nets     = connected components, by union-find
```

`nets(segments, pins, placements, parts, wires)` returns:

```js
{ nets: [ { id: "n0", segments: ["s:3:0", ...], pins: [...] } ],
  segmentNet: { "s:3:0": "n0", ... } }
```

Nets are numbered in ascending order of their lowest `(row, x0)` segment, so the output
is deterministic and a diff of two saved projects is readable.

## DRC

`drc(board, breaks, placements, parts, wires)` returns a flat list of
`{ severity, code, message, refs, holes }`, `severity` in `error | warning | info`.

| code | severity | condition |
|---|---|---|
| `pin-off-board` | error | a pin's `col`/`row` is outside the matrix |
| `hole-collision` | error | two **component leads** occupy the same hole |
| `short-across-part` | error | a non-link placement has two electrical pins in one segment |
| `wire-off-board` | error | a wire end is outside the matrix |
| `wire-degenerate` | error | a wire's two ends are the same hole |
| `duplicate-ref` | error | two placements or wires share a ref |
| `link-redundant` | warning | a link placement has both pins in one segment |
| `wire-redundant` | warning | a wire's two ends are already in the same segment |
| `pin-floating` | warning | a segment holds exactly one electrical connection |
| `segment-unused` | info | a segment holds nothing — dead copper |

`short-across-part` is the check that earns the whole model: it is exactly the mistake
that makes a hand-drawn stripboard layout fail, and it is invisible without segment
derivation.

## Files this creates

| file | contains |
|---|---|
| `src/model/geometry.js` | the verified physical constants; hole↔mm conversion |
| `src/model/board.js` | board/break/placement construction and validation |
| `src/model/rotate.js` | the four rotations, and pin resolution |
| `src/net/segments.js` | `segments()` |
| `src/net/derive.js` | union-find and `nets()` |
| `src/net/drc.js` | `drc()` |
| `src/parts/library.js` | the built-in generic part set |
| `tests/run.mjs` | the check harness — reports `passed/total`, never a bare exit code |
| `tests/net/test_connectivity.mjs` | the checks for the above |

## Explicitly NOT changed here

- `src/server/**`, `public/**`, `src/export/**` — separate tasks. This spec is pure
  model and must not acquire an HTTP or DOM dependency.
- Non-stripboard patterns (tripad, pad-per-hole). `board.pattern` is recorded as
  `"strip"` and validated as such, so the field exists for later without pretending
  the code handles more than it does.
- Netlist import. `net` objects carry an optional `name` field, unset in v1, so an
  importer can bind to them later without a schema change.

## What a green run means

`tests/net/test_connectivity.mjs` reports `N/N checks passed` where the checks include,
at minimum: break-to-segment splitting at both board edges and the middle; a resistor
bridging two strips producing **two** nets, not one; a wire link bridging two strips
producing **one**; a diagonal pen wire between arbitrary holes producing **one**; the four
rotations; that a wire end sharing a hole with a component lead raises nothing; and each
DRC code fired by a layout built to trigger it and silent on one built not to.
