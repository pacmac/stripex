# SPEC — point to point is a thing you pick, not a mode you find

status: implemented, entry CLOSED
area: component-library, editor-ui
source_hash:
  src/parts/library.js:  be3df2fbb753640c6783de188e400c56143ac9d7e278a256370ae184576a1845
  src/model/board.js:    eacc500a6093453e95c1be8bd94b26bd6ebaa491c2bf7d5e1ab5f078bb064dde
  src/model/edit.js:     9b3035ec81c37d023d81cd50734230ce9b4b3ba1ef9c7d50e75457552db53c88
  src/render/svg.js:     cea4959e62d9a3ce58ff5ca07c43866ccb6479fc18fe6c0687606e8149de51ec
  public/app.js:         60f19469b23871400a3c9e1197babe5cb2d211df8fb94c55282fdfb2bd860b52

## What the browser actually did

Red 6/12 → green 12/12, entry closed. 27 suites, 405 checks.

- **Point to point (pen)** is the first entry in the Parts palette.
- Choosing it armed the **wire** tool, not place. Drawing between two holes created a wire
  and **zero placements** — it cannot be placed even by accident.
- Choosing a resistor straight afterwards returned to the **place** tool.
- `value` set to `GND` and label colour to red: the wire stored
  `{ value: 'GND', silk: '#c92a2a' }`, two value texts were drawn, the ID label came out
  `#c92a2a` — and the **pad stayed `#7048e8`**, its length colour, which is the whole point
  of `silk` being the label rather than the wire.

## What I checked before agreeing with the premise

The request was that point to point "should not be part of wire link". It never was: they
are separate arrays with separate layers and no shared code path. Saying so first meant the
work landed on the thing that was actually wrong — that the palette listed thirteen items
and none of them was it, so it read as a mode rather than a thing.

Peter, 2026-08-30: *"I think point 2 point needs it's own component / object and should not
be part of wire link."*

## What I found before changing anything

They are **already separate objects**:

```
placements[]   parts, including the wire-link
wires[]        point to point, its own array
```

with their own layers (`Wire links`, `Pen wires`) and no shared code path — `linkColour`
and `wireColour` are two functions that happen to use the same 0–9 code.

So the model already is what was asked for. What is missing is its **presence**: the parts
palette lists thirteen items and none of them is point to point. It exists only as the Wire
tool, so on screen it reads as a mode of wiring rather than a thing you place — which is
what makes it look like part of the wire link.

## The palette entry

`point-to-point` joins the library as a first-class entry, at the top beside the wire link.

It carries `places: 'wire'`, meaning **choosing it arms the wire tool rather than the place
tool**. That one field is what lets it live in the same list as everything else: the palette
stays built from `partList()` alone, rather than growing a second source that has to be
kept in step. This project has already paid for a second list once, when ref prefixes
drifted from the library and shipped a part called `X1`.

A part with `places: 'wire'` can never be a placement. `validateProject` rejects one, because
nothing else would: it has no pins, so it would resolve to no geometry and simply be
invisible rather than reported.

## What a pen wire gains

| field | does |
|---|---|
| `value` | a name for the run — `GND`, `+5V` — shown beside the ID on the board |
| `silk` | the colour of the ID text |

`silk` is the **label** colour, not the wire's. A pen wire's pads are already coloured by
length, and that colour is load-bearing — it says which pre-cut wire to take from the
drawer. A second colour on a two-element object would be a control with almost nothing to
act on, so it acts on the one part of a wire that is silkscreen: the letter printed next to
it.

## Files

| file | change |
|---|---|
| `src/parts/library.js` | the `point-to-point` entry, `placesWith()` |
| `src/model/board.js` | reject a placement of a wire-only part |
| `src/model/edit.js` | `value` and `silk` on a wire |
| `src/render/svg.js` | draw the value; label in the wire's silk colour |
| `public/app.js` | picking it arms the wire tool; the two new fields in Focus |

## Explicitly NOT changed

- The storage split. Pen wires stay in `wires[]`: a pen wire has no span, no rotation and
  two independent endpoints, so most of a placement's fields would be meaningless on one.
- The wire link, its `L` refs and its drawn line.
- Pad colour, which stays the length colour.

## What a green run means

`tests/parts/test_point_to_point_part.mjs` reports `N/N checks passed`: the library has a
`point-to-point` entry and it appears in `partList()`; it declares `places: 'wire'` while
every other part places normally; `validateProject` rejects a placement that uses it and
accepts one that uses a real part; a wire's `value` and `silk` apply and clear; the ID label
is drawn in the wire's silk colour when set and the theme's otherwise; the value is drawn
beside the ID when set and nothing extra when not; and the pads keep the length colour
whatever `silk` says.
