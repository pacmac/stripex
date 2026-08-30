# boards

One `.json` per board. The filename is the board's **slug**; the name a person reads is
`name` inside the file.

These are in the repository on purpose:

- **anyone can edit one** — including Claude, which is the point. Open the file, change it,
  save it.
- **git is the recovery** for a board that goes wrong. A board has already been lost once in
  this project, and `git log -p boards/` is the answer to "what did it look like yesterday".

## Editing one by hand while the editor has it open

Safe, and guarded. Every read hands out a version — the SHA-256 of the bytes — and every write
must present the version it started from. If you change the file underneath a running editor,
its next save is **refused**, and it offers you the newer board rather than overwriting your
work. See `docs/specs/boards-on-the-server.md`.

## The shape of a file

`src/model/board.js` is the authority. In outline:

```json
{
  "schema": "stripex/1",
  "name": "TMC2209 driver board",
  "board": { "cols": 25, "rows": 20, "pattern": "strip" },
  "breaks":     [ { "row": 7, "x": 5, "at": "hole" } ],
  "placements": [ { "ref": "U1", "part": "dip", "at": { "col": 4, "row": 3 }, "rot": 90, "span": 7, "width": 6 } ],
  "wires":      [ { "ref": "A", "from": { "col": 1, "row": 2 }, "to": { "col": 1, "row": 6 } } ],
  "netLabels":  { "0,0": { "name": "GND" } }
}
```

Anything the editor cannot read is **repaired on load, never discarded**, and it tells you
what it dropped — `src/model/repair.js`.
