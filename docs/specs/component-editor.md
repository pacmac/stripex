# SPEC — a component editor, catalogue first

status: draft
area: component-library
source_hash: (set in Phase 4)

Peter, 2026-08-31: *"next task is a component editor screen"*, and on scope: **both, catalogue
first** — define devices, then let a placement override what it inherited.

## Why this, and why now

Every component problem this week needed **me** to edit source:

- the JST body was the wrong size, twice — first from invented proportions, then from a
  footprint library that disagreed with the part in his hand;
- `tmc2209` carries `NC3` and `NC4`, two pin names that only Peter's silkscreen can settle,
  and they have been sitting unverified for two days;
- his SMT parts want a **1206** land, which the library does not have, because an 0603 cannot
  bridge two strips;
- and the catalogue's TMC2209 pin order disagrees with his own board's labels on four pins.

`DEVICES` is a hardcoded object. **Peter cannot add or fix a component himself**, and he is the
one holding the part.

## Built in two halves

| | |
|---|---|
| **A — the catalogue is data** | a store on the server, validation, an API, and the model reading the stored set over the built-ins. Provable with no browser. |
| **B — the screen** | a Components view: list, edit, preview against a board, save. |

Placement overrides come after both, and reuse B's field editing. `ops.setPinNames` already
does the pin-name half.

## A. The catalogue is data

**The built-ins stay in code and stay the defaults.** A fresh install has the XIAO, the
TMC2209 and the fourteen JST variants without a file existing. The store holds only what Peter
has **added or changed**, which is also what makes the file worth reading.

```
devices.json     one file, not a directory: a JST family is fourteen entries and
                 nobody wants fourteen files to see what has been customised
```

- `installDevices(list)` puts the stored set over the built-ins. **Synchronous**, because
  `getDevice` is called synchronously from `ops.addPart`, `placementFor`, `netlist` and the
  editor's palette, and making the catalogue async would reach all four.
- `getDevice` and `deviceList` read the merged set; `deviceList` says which are `builtIn`, so
  a screen can offer "revert to stock" honestly.
- The server installs at boot and after every write. The browser installs what `/api/devices`
  returns before its first draw.

**Validated at the door**, because a bad device is a board that cannot be drawn: the id is a
slug, the base part must exist, pin names must be non-empty and unique, span and width are
positive integers, and a device whose pin count does not match its footprint is refused
naming both numbers.

| route | |
|---|---|
| `GET /api/devices` | the merged list, each saying whether it is built in |
| `GET /api/devices/:id` | one device, in full |
| `PUT /api/devices/:id` | create or override; refused with the reason |
| `DELETE /api/devices/:id` | drop an override — a built-in returns to stock, a custom one goes |

## B. The screen

A **Components** view: the devices down one side, the selected one's fields beside it, and a
live preview of the footprint on a scrap of board. Pin names as a numbered list with the
unverified ones marked, because that is the field this project keeps getting wrong.

## Explicitly NOT changed

- `placementFor` and the rule that a placement **copies** the catalogue and never references
  it. A board already built does not change when a device is edited — that is the whole reason
  the copy exists, and editing a device must not reach backwards into boards.
- The built-in definitions themselves, including `NC3`/`NC4`, which stay unverified until
  somebody reads the part.
- Boards, the rules, the DRC.

## What a green run means

`tests/parts/test_device_store.mjs` and `tests/server/test_api_device_edit.mjs` report `N/N`:

- with no `devices.json`, every built-in device is still there — a fresh install is complete;
- a stored device **overrides** a built-in of the same id, and `deviceList` marks it not built
  in, while `DELETE` returns it to stock;
- a new device appears in the list and can be placed on a board through `addPart`;
- **an invalid device is refused, naming what is wrong** — unknown base, duplicate pin names,
  a pin count that does not match the footprint, a bad id;
- editing a device **does not change a board already built from it**, because the placement
  copied what it needed;
- and the model, the API and the palette all agree on the merged set.
