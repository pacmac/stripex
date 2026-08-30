# SPEC — the rules belong to the board, and every edit is a function

status: implemented, entry CLOSED
area: board-model
source_hash:
  src/model/rules.js:    3d095225c6ccc5d50f88e2e52eeb0964a04b21224ac66b27f33efc2a7eba1c55
  src/model/ops.js:      77bf983082b9b7e05c9533c826a5445804a2475d469d093e29f69ae73f306fe8
  src/server/index.js:   c9d4385a76a92cd87eee5caff1d51ee88a9d816e4609cfcc135b95fce8572789

## One rule is NOT checked, on purpose

`linksAreStraight` has no checker. A link's pins are collinear in the library and a rotation is
one of four right angles, so **no placement can produce a diagonal link** — a checker for it
would be code that can never fire, which is worse than no checker because it reads as
protection. The rule is enforced where it can actually be broken: `addLink` refuses two holes
that are not in line, which is precisely the request I made when a link's end landed on the
wrong strip.

Peter, 2026-08-30: *"so this is where the claude skill will come in, and those design rules I
told you should not just be in memory, they should be part of stripex. and what is needed now
is an API so that an entire board can be built and modified via the API"*

## Why, from today rather than from principle

I wired his rotator board three times and got it wrong twice.

- **Every pen-wire endpoint landed in a hole that already had a pin in it.** Nine of ten. The
  DRC reported zero errors, and its source *documents the opposite rule* — "a pen wire is
  soldered to the joint a component lead already occupies" — so nothing anywhere would have
  stopped me.
- **I grounded CLK with a pen wire.** He had told me, and I had written it into
  `architecture-for-netlist.md` myself: *"point to point can be anywhere for signals only.
  power lines must be wire links."* It was in a document, so it bound nothing.

Both were caught by Peter reading the screen. Each fix was a throwaway script in a scratch
directory that re-implemented hole-finding, occupancy and straightness — and the third of
those scripts had an off-by-one in a link's span that put its end on the wrong strip.

So: the rules go in the project, the operations go in the model, and the scripts stop
existing.

## The rules, as data, in the project

`project.rules`, defaulted from `DEFAULT_RULES` when absent — so every board that exists today
opens unchanged and acquires the defaults.

```js
{
  linksAreStraight: true,      // a link's ends share a row or a column
  penWiresFreeHolesOnly: true, // a pen wire ends in a hole with nothing in it
  penWiresSignalsOnly: true,   // no pen wire touches a power net
  powerUsesLinks: true,        // a power connection between strips is a link
  netClasses: { power: [...patterns...] },
}
```

**In the project, not in settings.** A saved board must reproduce its own findings: if the
rules lived beside the application, opening an old board on a differently configured machine
would report different errors about identical copper. That is the same failure as a placement
referencing a catalogue entry, which this project has already been bitten by once.

**Net class comes from the name**, because that is the only thing that knows. `0V`, `GND`,
`VMOT`, `VUSB`, `3V3`, `5V`, `+12V` are power by pattern; anything unmatched is a signal. The
patterns are part of the rule set, so the day someone calls a rail `RAW` it is an edit rather
than a code change.

## `checkRules(project)` — findings, in the DRC's shape

Same `{severity, code, message, refs, holes}` the DRC already uses, so the Checks tab can show
them without learning a second format. It is a separate function rather than a branch inside
`drc()` because `drc()` is one 209-line function and adding to it is the thing
`drc-is-one-function-not-a-list-of-rules` already objects to.

## `src/model/ops.js` — every edit as a pure function

```js
addPart(project, {part, at, rot, span, width, device})  -> {project, ref} | {error}
removePart(project, ref)                                -> {project}      | {error}
movePart(project, ref, pin, hole)                       -> {project}      | {error}
addWire(project, from, to)                              -> {project, ref} | {error}
addLink(project, from, to)                              -> {project, ref} | {error}
setBreak(project, {row, x, at})                         -> {project}      | {error}
clearBreak(project, {row, x})                           -> {project}      | {error}
setLabel(project, hole, {name, colour})                 -> {project}      | {error}
```

Every one:

- takes a project and returns a **new** one, never mutating its argument;
- **refuses** an operation the rules forbid, with the rule named — `addWire` into an occupied
  hole returns `{error: 'pen-wire-on-a-pin'}` rather than a board;
- computes what it can: `addLink` derives `rot` and `span` from two holes and refuses if they
  are not in line, which is the off-by-one that bit me.

Plus the query I kept rewriting badly:

```js
freeHolesOn(project, ref, pin)   // holes on that pin's strip with nothing in them
```

## `POST /api/boards/:slug/ops` — a board built over HTTP

```json
{ "version": "…", "ops": [ {"op": "addLink", "from": …, "to": …}, … ] }
```

Applied **in order, all or nothing**: the first refusal aborts the batch and the board on disk
is untouched. The response says which op failed and why. Same version guard as `PUT`, so a
batch cannot silently overwrite somebody who moved first — the guard I defeated today by
fetching a fresh token for stale content.

## Files

| file | change |
|---|---|
| `src/model/rules.js` | new: `DEFAULT_RULES`, `rulesFor`, `netClassOf`, `checkRules` |
| `src/model/ops.js` | new: the operations and `freeHolesOn` |
| `src/server/index.js` | `POST /api/boards/:slug/ops` |

## Explicitly NOT changed in this spec

- `drc()`, which keeps its own rules. Splitting it is `drc-is-one-function-not-a-list-of-rules`.
- The editor, which still mutates `state.project` inline. Moving it onto `ops.js` is
  `there-is-no-headless-way-to-build-a-board`, and this is the half that has to exist first.
- Peter's board.

## What a green run means

`tests/model/test_rules.mjs` and `tests/model/test_ops.mjs` report `N/N checks passed`:

- a board with no `rules` gets the defaults, and a board carrying its own keeps them;
- `netClassOf` calls `0V GND VMOT VUSB 3V3 5V +12V` power and `STEP DIR SDA EN` signal;
- **`checkRules` flags a pen wire ending in a hole that has a pin in it** — the fault I made
  nine times on his board;
- **it flags a pen wire touching a power net** — the fault I made grounding CLK;
- it flags a link whose ends are not in line;
- a board that obeys the rules produces no findings;
- `addWire` **refuses** both of those rather than producing a board, and names the rule;
- `addLink` derives rot and span from two holes, refuses a diagonal, and its ends land exactly
  on the two holes given — the off-by-one that put a link on the wrong strip;
- every op returns a new project and leaves its argument untouched;
- and, as one check: **Peter's board, rebuilt from its parts by ops alone, matches the board on
  disk** — the same wiring, arrived at through the API instead of a script.
