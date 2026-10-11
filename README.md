# stripex

A stripboard layout editor that runs in a browser. Place components on the grid, cut the
copper where it has to be cut, link the strips, and print a build sheet you can work from at
the bench with a pencil.

Stripboard's one unforgiving mistake is a part whose two legs land on the same uncut strip —
the component is shorted out, the board looks right, and nothing tells you. stripex derives
the nets from the copper itself, so it can say so before you solder.

## What it does

- **Place parts** from a library of footprints — axial and radial passives, TO-92, TO-220,
  SOT-23, DIL sockets, pin headers, JST XH connectors in every way from 2 to 8 — or from a
  catalogue of named **devices** (a Seeed XIAO, a TMC2209) that carry real pin names.
- **Cut the strips**, by knife between two holes or a spot-face at one. A DIL cuts its own.
- **Wire it**: wire links across the strips, and point-to-point pen wires hole to hole,
  coloured by length.
- **Derive the connectivity** from the segments the cuts leave behind — nets are never stored,
  so they cannot go stale — and name a net by naming a hole.
- **Check it**: ten rules derived from the copper — a shorted part, two leads in one hole, two
  bodies in the same place, a pad sitting across a cut, a strip carrying one connection — and
  on top of them a rule set you can configure, which is where a pen wire on a power rail and a
  polarised part the wrong way round (judged by the names of the nets its pins land on) are
  caught.
- **Print a build sheet**: both sides of the board at a stated scale, with a bill of materials,
  a cut list and a wire run list, each row with a tick box, fitted to one A4 page.
- **Check a board against a netlist**, or plan the placements that would satisfy one.

## Running it

```sh
pnpm install
pnpm run browsers   # chromium, for the browser checks only
pnpm start          # http://localhost:3020
```

| variable | default | what it is |
|---|---|---|
| `PORT` | `3020` | the port it listens on |
| `HOST` | `0.0.0.0` | the interface it binds |
| `STRIPEX_BOARDS_DIR` | `boards/` | where boards are read and written |
| `STRIPEX_DEVICES_FILE` | `devices.json` | the component catalogue you have added to |

Boards are files. The editor saves continuously to the server, and every open editor follows a
change over a live feed, so the file and the screen cannot disagree.

## Building a board over HTTP

Everything the editor does to a board, a script can do:

```sh
curl -X POST localhost:3020/api/boards/my-board/ops -H 'content-type: application/json' -d '{
  "ops": [
    {"op": "addPart", "part": "res-axial", "at": {"col": 2, "row": 3}, "value": "10k"},
    {"op": "setBreak", "row": 3, "x": 5, "at": "gap"},
    {"op": "addWire", "from": {"col": 0, "row": 0}, "to": {"col": 9, "row": 0}}
  ]}'
```

Applied in order, **all or nothing**: the first refusal aborts the batch and the file is
untouched, and the response says which operation stopped it and why. The sixteen operations are
`addPart`, `removePart`, `movePart`, `editPart`, `setSide`, `setPinNames`, `adoptDevice`,
`addWire`, `removeWire`, `editWire`, `addLink`, `setBreak`, `clearBreak`, `setLabel`,
`setRules` and `setBoardSize`.

Also: `GET /api/boards`, `/api/boards/:slug`, `/check`, `/usage`, `/free-holes`,
`POST /api/boards/:slug/netlist/check` and `/netlist/plan`, `POST /api/render` for an SVG, and
`/api/devices` to read and write the catalogue.

**What the API cannot do yet**, measured rather than guessed: there is no bill of materials or
cut list over HTTP (they are computed in the browser), no render of a stored board by its slug,
and no snapshot history — the editor's snapshots live in one browser's local storage.

## How the work is governed

Two things in this repo are not the editor:

- **`idiot.yaml`** — the register. Every bug and wanted change is an accusation with a named
  test, and it is closed only by a test that ran red before the fix and green after. Verdicts
  are derived from what the test did; none is ever typed.
- **`.proofs/`** — the captured output of those runs, two files per entry: the red and the
  green. They are the evidence that a fix was ever a fix.

`docs/specs/` holds one document per change, saying what was really happening and what a green
run would mean. A spec is written before the code, and the register entry points at it.

## Checks

```sh
pnpm run check      # 93 suites
```

Most run in node against pure modules — the renderer takes a project and returns a string, with
no DOM — so they are fast. The rest drive a real browser, because a present DOM element is not
a drawn one, which this project has learned more than once.

## Known limits

- One board pattern: `strip`. The field exists so another engine needs no schema change.
- `public/app.js` is being taken apart; the Print view and the component editor are their own
  modules, and a check holds the rest to the line count that closes it.
- Snapshots are per browser, as above.

## Licence

ISC — see [LICENSE](LICENSE).
