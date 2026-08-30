# SPEC — build and check a design against a netlist

status: draft
area: board-model
source_hash: (set in Phase 4)

Peter, 2026-08-30: *"a BIG one, creating of a new design from a netlist. I dont think that can
be done by a script and would effectively be a claude interractive script that will allow you
to build a real board."*

**Interactive is the requirement, not a concession.** An autorouter that places and wires a
whole board unattended is not what was asked for and is not what would be trusted. What is
asked for is a loop: state the intent, see what the board does and does not yet satisfy,
propose the next moves, apply the ones that are right. So stripex owes three things — a
netlist it can read, a comparison it can run, and a proposal it can offer. The judgement stays
with the person.

## What is missing today

Nothing in `src/` reads a netlist. When v5 sent one, I compared it to Peter's board **by hand,
three times, in throwaway scripts** — which is exactly how nine pen-wire ends came to sit on
pins and how I told him 0V and 3V3 were shorted when they were not. Every one of those was a
comparison a program should have done.

## Phase 1 found something that changes the shape of this

**Peter's chips are not devices.** `TMC2209` and `U1` on his board are `part: "dip"` with no
`device` and no `pinNames` — bare sixteen- and fourteen-pin footprints, drawn before the device
catalogue existed. His net names are anchored to HOLES and were placed by eye.

```
TMC2209  part=dip  device=None  pinNames=0
U1       part=dip  device=None  pinNames=0
J4       part=jst-xh  device=jst-xh-3-right  pinNames=3
```

A netlist says `U2.STEP`. His board can only answer `TMC2209.16`. **So a netlist cannot address
the board he actually has**, and the feature would be born unable to touch the only real board
in the project. That is not a detail to discover during implementation.

Hence `adoptDevice` below, which is not scope creep — it is the difference between a feature
that works on his board and one that works on a fresh one.

## The netlist

Text, because a person and another repo both have to write it:

```
part U1 xiao
part U2 tmc2209
net 0V    U1.GND U2.GND U2.GNDM
net STEP  U1.D0  U2.STEP
```

`part <ref> <device>` and `net <name> <ref.pin>...`, `#` to end of line is a comment, order
irrelevant, repeated `net` lines for one name merge. JSON is accepted as the same thing already
parsed: `{parts: {U1: 'xiao'}, nets: {'0V': ['U1.GND']}}`.

**A pin is named, never numbered.** `U2.4` is refused with the device's real pin names offered,
for the reason `device-aware-api.md` already gives: a caller who has to count pins is a caller
about to get one wrong.

## `src/model/netlist.js`

| function | answers |
|---|---|
| `parseNetlist(text)` | `{parts, nets, problems}` — problems name the line |
| `compareToNetlist(project, netlist)` | per net: `satisfied`, `split` (which pins are on which board net), or `absent`; plus **shorts** |
| `netlistFindings(project, netlist)` | the same thing in the DRC's finding shape, for the Checks tab |
| `planFor(project, netlist)` | ops that would join what is split, each with its reason, and refusals with theirs |

**The short check is the one that matters most.** Two netlist nets landing on one board net is a
short — the fault that is invisible on a drawing and permanent on copper. It is reported before
anything else, because a missing connection is work outstanding and a short is damage.

`planFor` obeys the rules rather than restating them: power by wire link, signals by pen wire
between free holes, links straight. Where it cannot honour a rule it **refuses that connection
and says which rule**, rather than proposing something the API would reject.

## `adoptDevice(project, ref, device)` — a new op

Attaches a catalogue device's pin names, span, width and silk to a placement that already
exists, so a bare DIP becomes the chip it always was. Refused, naming the mismatch, when the
device's pin count differs from the footprint's — an adoption that silently renumbered pins
would corrupt a board rather than describe it.

## Files

| file | change |
|---|---|
| `src/model/netlist.js` | new — parse, compare, findings, plan |
| `src/model/ops.js` | `adoptDevice`, and `setNetlist` to store one on the project |
| `src/server/index.js` | `POST /api/boards/:slug/netlist/check`, `.../plan` |
| `src/render/panels.js` | a `netlist` tab |
| `public/app.js` | the tab's body, and netlist findings in Checks |

## Explicitly NOT changed

- The rules. `planFor` consults them; it does not get its own copy.
- `ops.js`'s refusals. A plan is a list of proposed ops and is applied through the same
  `applyOps` as anything else, all or nothing.
- Automatic placement. Nothing in this decides where a chip goes.

## What a green run means

`tests/model/test_netlist.mjs` and `tests/server/test_api_netlist.mjs` report `N/N`:

- a netlist parses, and a bad line is reported with its line number rather than dropped;
- `U2.4` is refused and the real pin names are offered;
- **two netlist nets on one board net are reported as a short, first**;
- a net whose pins sit on two board nets is `split`, naming the pins on each side;
- a satisfied net is `satisfied` — including on a board built through `applyOps` from the
  netlist's own plan, which is the loop closing;
- `adoptDevice` turns a bare 16-pin DIP into a TMC2209 with sixteen names, and is refused on a
  footprint of the wrong size;
- **and Peter's own board, adopted and compared against v5's rotator netlist, reports zero
  shorts** — the check I ran by hand, now run by the program.
