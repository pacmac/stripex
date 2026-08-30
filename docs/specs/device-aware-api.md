# SPEC — the API can place a real component

status: implemented, entry CLOSED
area: board-model
source_hash:
  src/model/ops.js:     0b556aa2969f52308f966002170d89908326db669472e24f3899ac27a243153c
  src/server/index.js:  ad26f23d1d3380538255aee68c4eb8f2d5d9b08099fc99171ceefb7887c6d3bb

## A pin is asked for BY NAME

Which fell out of writing the checks: a XIAO has no pin `3`. It has `D0`..`D10`, `3V3`, `GND`
and `5V`, because the device carries names and `resolvePins` resolves them. So
`free-holes?ref=U1&pin=3` is a **404**, and `pin=D4` is the question a caller actually means.
That is the catalogue doing its job — a caller who has to count pins is a caller about to get
one wrong.

Peter, 2026-08-30: *"so can the api be used by v5 to build a new board ?"*

Measured, rather than answered: partly, and not well enough.

## The three gaps, as they measured

**1. A device places as a bare footprint.** `addPart {device: 'xiao'}` returned
`span: 7, width: 3, pinNames: 0` — the **DIP defaults**. A XIAO is `span 7, width 6` with
fourteen names. The `device` field is copied as a *tag* only, and `placementFor` — which exists
and does this correctly — is never called. So v5 would place a chip of the wrong size with no
pin names, which is precisely what the device catalogue was built to prevent.

**2. `GET /api/devices` is 404.** `/api/parts` exists; devices never got the same. v5 has no
way to learn that `xiao`, `tmc2209` and the fourteen JST variants exist, what they are called,
how many pins they have, or which of those pins are unverified.

**3. `freeHolesOn` is model-only.** It is the query that decides where a pen wire may land —
the one I wrote three times in scratch scripts and got wrong twice — and it has no route. v5
would have to guess endpoints, which is exactly how nine wires ended up on pins.

## The changes

- **`addPart` resolves a device through `placementFor`** when given one, so span, width, silk,
  autoBreak and pin names all come from the catalogue. A device that is not in it is refused by
  name rather than silently placed as its base part.
- **`GET /api/devices`** — the same shape `deviceList()` already returns, including
  `unverifiedPins`, because a caller wiring to a pin deserves to know the name is unchecked.
- **`GET /api/boards/:slug/free-holes?ref=U1&pin=3`** — the holes on that pin's strip that
  nothing occupies, so a caller can choose an endpoint instead of guessing one.

## Files

| file | change |
|---|---|
| `src/model/ops.js` | `addPart` resolves a device |
| `src/server/index.js` | `GET /api/devices`, `GET /api/boards/:slug/free-holes` |

## Explicitly NOT changed

- `placementFor` and the rule that a placement copies the catalogue and never references it.
- The rules, which apply to a device's wiring exactly as to anything else.
- The editor.

## What a green run means

`tests/model/test_ops.mjs` and `tests/server/test_api_devices.mjs` report `N/N checks passed`:

- **`addPart {device:'xiao'}` gives span 7, width 6 and fourteen pin names** — the measured
  failure;
- a TMC2209 comes back span 8, width 5, sixteen names, and its silk and autoBreak;
- an unknown device is refused, naming it, rather than placed as a bare DIP;
- `addPart` without a device is unchanged;
- `GET /api/devices` lists every device with its pin count and its unverified pins;
- `GET /api/boards/:slug/free-holes` returns holes on the pin's strip, never the pin's own
  hole, and 404s for a pin that is not there;
- and, end to end: **a rotator board built through the API alone** — create, place a XIAO and a
  TMC2209 by name, ask where a wire may land, wire it, and read back a board whose pin names
  are the real ones.
