# GAP — drc() is one function, so a new check is another branch inside it

status: done
area: connectivity

Registered as `drc-is-one-function-not-a-list-of-rules`: *"drc() is a single 209-line function
with comment-separated sections, so a new check — netlist conformance among them — is another
branch inside it rather than a new file."* Named in `docs/specs/architecture-for-netlist.md`
as one of the three seams a netlist builder needs.

Today the ten checks are comment banners inside one function sharing a mutable `out` array and
a dozen locals. A new check means editing the one function everything else depends on, and
nothing can run a single rule — which is what accepting a finding, or checking a board against
a netlist, will both want.

## The change

`drc()` builds the **context** once — segments, their index, resolved pins, the board and the
`onBoard` test, placements, wires, `getPart` — and then runs each rule with it:

```js
export const RULES = [
  { name: 'duplicate-refs', run: (ctx) => [...] },
  ...
];
export function drc(board, breaks, placements, getPart, wires) { ... }
```

Each rule is a **pure function of the context returning findings**, in the order they run
today. `drc()` concatenates them. The two early returns stay in `drc()` itself, because they
are about being unable to build the context at all: a bad break returns `bad-break` alone, and
an unresolvable placement pushes `bad-placement` and carries on with no pins.

**Nothing about the output changes.** Same findings, same codes, same severities, same
messages, same order — that is the whole point of doing it as its own commit.

## Files

| file | change |
|---|---|
| `src/net/drc.js` | the rules become a list of named functions over one context |

## What a green run means

`tests/net/test_drc_rules.mjs`:

- `RULES` is a list of at least nine `{ name, run }` entries, every `run` a function, every
  name unique;
- a fixture board that trips nine of them produces **exactly** the 25 findings it produces
  today, in the same order, recorded in the test as the baseline;
- running one rule alone over the same context gives that rule's findings and nothing else.
