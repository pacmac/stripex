# SPEC — the three seams a netlist builder needs

status: proposed — nothing implemented
area: architecture

Peter, 2026-08-30: *"I plan on adding a lot of new features, including components, and a BIG
one, creating of a new design from a netlist… does the current architecture etc CLEAN and does
it support extending the functionality easily?"*

This is the measured answer, and the work it implies. **Nothing here is done.** It is written
down so the next session starts from evidence rather than from a fresh opinion.

## What is already right, with the measurement

| | evidence |
|---|---|
| the layering is acyclic and correct | `geometry → segments → derive → nets/drc → render`. **No module under `src/model`, `src/net` or `src/parts` imports anything from `src/render`.** That is the property that usually rots first, and it has not |
| the library is data-driven | 14 parts, and **zero** hardcoded part ids outside `library.js`. The `case 'dip'` and `case 'header'` in `svg.js` are body *shapes*, not part ids. Adding a component is a data edit; only a genuinely new outline costs one `case` in `bodyFor` |
| the renderer is pure | project in, string out, no DOM. Which is why node runs the same code the browser does and 38 suites need no browser |
| nets are derived, never stored | so they cannot go stale, and a name anchors to a **hole** — exactly the primitive a netlist importer needs to say "this strip is VCC" and have it survive every edit |

So: adding **components** is already easy. That half of the question is a clean yes.

## The three things that block a netlist builder

### 1. There is no headless way to build a board

Every mutation of the project lives inside the DOM click handler:

```js
// public/app.js, inside onBoardClick()
p.placements.push(pl);
p.wires.push(wire);
p.breaks.push({ row, x, at: state.cut });
p.placements = p.placements.filter((x) => x.ref !== ref);
```

mixed in with `state.selection`, `say()`, `draw()` and `commit()`. **There is no
`addPart(project, …)` to call.** A netlist builder — script or agent — has exactly three
options today: duplicate the logic, drive the DOM, or hand-write JSON. All three mean the
board built from a netlist and the board built by hand go through different code, and only
one of them is tested.

**This is the single biggest blocker, and it is worth doing before any of the rest.**

`src/model/ops.js`: pure `project → project` functions — `addPart`, `removePart`, `movePart`,
`addWire`, `removeWire`, `setBreak`, `clearBreak` — each returning a new project and a
description, with no notion of selection, status line or history. `app.js` calls them, and
so does everything that comes later.

### 2. The model asks the renderer what a net is

```js
// src/render/svg.js
export function netsFor(project) { … }
export function findingsFor(project) { … }
export function runList(project) { … }
export function cutList(project) { … }
```

`app.js` and `src/server/index.js` both import connectivity from a module whose job is to
produce an SVG string. A netlist importer would have to import the **renderer** to ask what is
connected to what.

These four are model queries wearing a renderer's coat. They move to `src/model/query.js`;
`svg.js` imports them. Mechanical, no behaviour change, and it stops the next person
importing the drawing to ask about the circuit.

### 3. `public/app.js` is 1379 lines — 30 % of the codebase

It holds four separable things: state and persistence; every mutation; every panel painter;
and all the event wiring. Split along the seams that already exist:

- `public/state.js` — state, `load`/`persist`, history, `commit`
- `public/panels/*.js` — one painter per tab and per card
- `public/tools.js` — the click handler, now calling `ops.js`

Do this **after** ops.js, so the split is along a boundary that exists rather than one
invented for the occasion.

## Two smaller things found on the way

- `provideSegmentNet()` in `src/model/nets.js` writes `globalThis.__stripexSegmentNet__`, and
  **nothing reads it**. A dead global.
- `drc()` is one 209-line function with comment-separated sections, not a list of rules.
  "Does this board match its netlist?" is a natural DRC rule and would be another branch in
  that function rather than a new file.

## Then the netlist feature itself

With the seams above, it is a new directory that touches nothing existing:

```
src/netlist/parse.js     a netlist -> { nets: [{name, pins:[{ref,pin}]}], parts: [...] }
src/netlist/plan.js      a netlist + a board size -> a list of OPS, not a project
src/netlist/verify.js    project + netlist -> what is joined that should not be,
                         and what is not joined that should be
```

**`plan` returning ops rather than a project is what makes it agent-driven.** The plan is
inspectable and editable before anything is applied, each op is applied by the same code the
editor uses, and `verify` + `drc` say whether the result is right. A script can run the whole
pipeline; a person or an agent can intervene at any step. The two are not different designs —
the interactive one is the batch one with a pause in it.

`verify` is what makes the whole thing trustworthy, and it is worth writing **first**: a
checker that can say "your board does not match your netlist" is useful on its own, on boards
built entirely by hand.

## Design rules are data, and they live in the project

Peter, 2026-08-30: *"then we will need a simple design rules. i/e wire links can only be
straight, point to point can be anywhere for signals only. power lines must be wire links, and
probably laid in first. this list will grow so it needs to be configurable."*

Three of those are constraints on the **planner** and one is a constraint on the **order** it
works in, and every one of them is also a thing `verify` should be able to report on a board
built by hand. So they are neither planner code nor DRC code: they are a **rule set both
read**.

```js
// the default, as data
{
  linksAreStraight: true,          // a link placement is already straight by construction;
                                   // the rule makes it checkable rather than merely true
  penWiresCarry: ['signal'],       // point to point is for signals
  powerUses: 'link',               // power nets must be wire links, not pen wires
  order: ['power', 'ground', 'signal'],   // and are laid first
  netClassOf: { /* name pattern -> class */ }
}
```

**Stored in the project, not in settings.** A saved board must reproduce its own findings: if
the rules lived beside the application, opening an old board on a machine configured
differently would report different errors about identical copper. That is the same failure as
a placement referencing a catalogue entry, which this project has already been bitten by once.
A board carries the rules it was built under; changing them is an edit to the board, and shows
up in the undo history like any other.

`netClassOf` is what makes the rest work: a rule about *power* needs to know which nets are
power, and the only thing that knows is the net's name. `VCC`, `+5V`, `GND`, `0V` and `VMOT`
are power by pattern; anything unmatched is a signal. The map is part of the rule set so it is
editable, because the day someone calls a rail `RAW` is the day a hardcoded list is wrong.

The list will grow, so the shape matters more than the four entries: **each rule is a named
function over `(project, ruleSet)` returning findings**, registered in a list — which is the
same change `drc-is-one-function-not-a-list-of-rules` already asks for. Do them together.

## Order

0. The components Peter asked for first — XIAO, TMC2209, JST connectors — which need only
   the device catalogue that already exists, plus a way to reach it from the Library.
1. `ops.js` — everything else either uses it or duplicates it.
2. Move the four query functions out of the renderer.
3. `netlist/parse.js` + `netlist/verify.js` — useful before anything can place a part.
4. Split `app.js`.
5. `netlist/plan.js`.
6. DRC as a rule list, with netlist conformance as one of the rules.

Steps 1 and 2 are refactors with no behaviour change, so each is provable by the existing 38
suites going green unchanged.
