# SPEC — a pen wire is two pads sharing an ID

status: implemented, entry CLOSED
area: editor-ui, board-model
source_hash:
  src/model/labels.js:  08cd97d20f354108870b324cb983084a14820c9cd9891eb8ebdec947bb657496
  src/model/board.js:   a652be9d32894d94d32b4055423439b47c1c60cdac05157502a6b33780c0fddb
  src/render/svg.js:    d14858f1e3c3aeba7a229acb7afa18f6fb97b0907b00ab6fa7f75e60d681cfd4
  public/app.js:        1afdf95669a6f6d0b8224dd678a9fb99966c0d0c575b3999753ba6f586f7f584

## What the browser actually did

Red 4/19 → green 19/19, entry closed. 26 suites, 393 checks.

Five pen wires drawn with the wire tool:

| ref | ends | holes | pad colour |
|---|---|---|---|
| A | (1,1) → (9,4) | 9 | white |
| B | (2,6) → (14,9) | 12 | red |
| C | (3,11) → (6,17) | 7 | violet |
| D | (16,2) → (22,12) | 12 | red |
| E | (18,14) → (20,18) | 4 | yellow |

Ten pads, refs `A A B B C C D D E E`, **no lines**. B and D are both red because both are
twelve holes — same wire, and the letter is what tells them apart.

Selecting C by clicking one of its pads drew **exactly one** line, `data-ref="C"`. Escape
cleared it. The run list read `A B C D E`.

## One behaviour worth knowing

The wire tool selects a wire as it creates it, so the line you just drew stays visible until
you click away. That falls out of the selection rule rather than being special-cased, and it
is the right default: you see the wire you just made, then it settles into a pad pair.

## Seven older checks stated superseded rules

All rewritten, none weakened, each carrying a note pointing here:

- `nextWireRef` returning `W1` → now `A`
- wire colour on the line's `stroke` → now the pads' `fill`
- "every wire has a casing" → the casing was a halo under the line; with no line the same
  job falls to the pad's outline, and the check now asserts a black pad and a white pad are
  both outlined against either ground
- "a pen wire is drawn between the centres of its two holes" → split in two: a pad on each
  centre, and the line between them **when selected**
- "labelled with its ref" → now asserts the label appears at **both** ends, since the ID is
  how you pair them up
- two layer/interactive-element lists naming `wire` → `wire-pad`

Peter, 2026-08-30: *"I dont see any support for point to point wiring pen markers / pads"*
then: *"so link needs to be 2 types, direct wire link, point to point. … with wiring pen /
point to point, the wire will not be drawn, it will appear as 2 pads with the same ID: i.e
A,B,C,D … AA, AB, AC etc."*

## What is there now, measured

A pen wire emits exactly three things: `wire-casing`, `wire`, `wire-label`. A line and a
label. **No pad at either end**, so nothing marks the holes a wire actually terminates in —
and on a board with forty wires the lines are spaghetti laid over the very thing you are
trying to read.

## The two types

Both already exist as separate objects. Only the second's presentation changes.

| | direct wire link | point to point |
|---|---|---|
| object | `wire-link` **part** — placement plus span | `wires[]` entry — from and to |
| shape | one axis, fixed span | any two holes |
| drawn | a line, **unchanged** — short, on-axis, and readable | **two pads sharing an ID, no line** |
| ref | `L1`, `L2` | `A`, `B` … `Z`, `AA`, `AB` |

They stay two objects rather than one with a `type` field: a direct link has a span and an
axis, a pen wire has two arbitrary endpoints, and merging them would mean a type field that
half the other fields depend on.

## IDs

Bijective base 26 — the spreadsheet column scheme: `A`…`Z`, `AA`, `AB`, … There is no zero
digit, which is why `Z` is followed by `AA` and not by `BA`.

`nextWireRef` allocates the **lowest free** label, so deleting a wire frees its letter and
labels stay short.

> **Sorting is not a string compare.** `A, AA, AB, B, BA` is what plain lexical ordering
> gives, and the run list is a build document — you work down it. It sorts by **length
> first, then lexically**, so `A, B, … Z, AA, AB`.

Wires and parts share one ref namespace, which `duplicate-ref` already checks. Bare letters
for wires against letter-plus-number for components is a clean read: `A` is a wire end, `R1`
is a resistor.

Refs already saved as `W1`, `W2` are **left alone**. Nothing distinguishes an auto-allocated
ref from one somebody typed, so renumbering on load would silently rewrite a deliberate name.

## The pads

Each end draws one pad marker plus its ID:

- **identical at both ends.** A pen wire has no polarity and no direction; marking one end
  differently would imply an order that does not exist.
- **in the wire's length colour.** Colour tells you which pre-cut wire to take from the
  drawer, and that matters *more* when there is no line to measure by eye, not less. A
  green pair is a 5-hole wire.
- clickable, and selecting either end selects the wire.
- distinct from a component pad, which is a silkscreen outline: a wire pad is filled.

## Tracing, which is the cost of dropping the line

With no line, *"is A really wired to A?"* becomes a scan of the board. So **selecting a wire
draws its own line, temporarily**, and marks both its pads. One wire's path, when you ask
for it — spaghetti only where it helps.

This makes the **run list the primary build document**: it is the only place the whole
pairing is written down.

## Files

| file | change |
|---|---|
| `src/model/labels.js` | **new** — `columnLabel()`, `labelIndex()`, `compareLabels()` |
| `src/model/board.js` | `nextWireRef` allocates letters |
| `src/render/svg.js` | wire pads; line only for the selected wire |
| `src/render/colours.js` | wire colour unchanged, now applied to the pads |
| `public/app.js` | run list sorted length-then-lexically |

## Explicitly NOT changed

- Net derivation and DRC. A point-to-point wire still merges the two segments it joins;
  only its drawing changes.
- The direct wire link, which keeps its line and its `L` refs.
- The wire tool's two-click gesture.

## What a green run means

`tests/render/test_point_to_point.mjs` reports `N/N checks passed`: `columnLabel` gives A, Z,
AA, AB and `labelIndex` inverts it; `nextWireRef` returns A then B and reuses a freed letter;
`compareLabels` sorts A, B, Z, AA, AB rather than A, AA, AB, B; a pen wire draws **two pads
and no line**; both pads carry the same ref and the same length colour; selecting the wire
draws exactly one line; a direct wire link still draws its line and is unaffected; and the
nets a pen wire joins are unchanged by any of it.
