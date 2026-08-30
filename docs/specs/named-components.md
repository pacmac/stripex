# SPEC — real components, with pin numbers and names

status: implemented, entry CLOSED
area: parts
source_hash:
  src/parts/devices.js:  9fd7494b9ba1dde05104b7b4dcf832e4ba381c0c4810a8dc81efca98ed6db45a
  src/parts/library.js:  8a8a364d965fc6fc08555fb0103f6b2a9146c5256aaf04c4248452d4f9479c4b
  src/render/svg.js:     7bd6a612836d5be699bd76eec27307ad7c58afcc5ea38d0a2a7e9cf71f0fd0eb
  public/app.js:         f25b670349c9d89fb16017d673a3f19cfab1006366c54218a16d70290499c8a6

sources:
  XIAO pinout and form factor:
    https://wiki.seeedstudio.com/Seeeduino-XIAO/
    https://mischianti.org/seeed-studio-xiao-esp32-c3-high-resolution-pinout-datasheet-schema-and-specs/
  TMC2209 SilentStepStick v2.0 pad coordinates and nets:
    https://github.com/malloc-19/SilentStepStickKiCad/blob/master/SilentStepStick-TMC2209_v20.kicad_pcb
  TMC2209 signal names:
    https://learn.watterott.com/silentstepstick/pinconfig/tmc2209/

Peter, 2026-08-30: *"the first one would be comonents with pin numbers and names. you can
create a XIAO and a TMC2209 as a starting point for the first 2 comonents."* and *"the other
component would be JST X connectors, right angle and straight, with pins from 2 to 8. I use
them a lot."*

## What exists and what does not

`src/parts/devices.js` already holds the right idea — a device is a **preset over a generic
footprint**, and placing one copies its parameters and pin names ONTO the placement so a
board never depends on the catalogue it was built from. That rule stays.

Two things are missing:

1. **Nothing imports `devices.js`.** Measured: the import graph shows `devices.js → library.js`
   and nothing pointing at `devices.js`. The catalogue cannot be reached from the editor, so
   its one entry has never been placed by anybody.
2. **Its one entry is guesswork.** The TMC2209 in it carries `unverifiedPins: true` and a
   comment saying so. Guessed pin names on a board someone actually builds are worse than no
   pin names, because they read as fact.

## The pinouts, and where each came from

### XIAO — verified

Two independent sources agree on the order, and the footprint is the same across the whole
XIAO family (SAMD21, RP2040, ESP32-C3, nRF52840), which is the point of the form factor.

- 7 pads per side, **2.54 mm pitch**, rows **15.24 mm** apart = **6 holes**. Board 21 × 17.8 mm.
- Numbered as this project numbers a DIL — down one side, back up the other — which happens to
  be exactly how the XIAO numbers itself:

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| left, top down | D0 | D1 | D2 | D3 | D4 | D5 | D6 |
| | **8** | **9** | **10** | **11** | **12** | **13** | **14** |
| right, bottom up | D7 | D8 | D9 | D10 | 3V3 | GND | 5V |

The alternate functions (`A0`, `SDA`, `SCL`, `TX`, `RX`, `MOSI`, `MISO`, `SCK`) are **not** in
the names. A pin has one name here, and `D4` is what the silkscreen says; the I²C role belongs
to the net, which is where `SDA` is already written on Peter's board.

### TMC2209 — sourced, with two pins honestly marked

Taken from a KiCad board file for the SilentStepStick TMC2209 v2.0, which gives pad
coordinates and net names rather than a picture:

- Two 8-pin headers at x = 142.1511 and x = 154.8511 → **12.7 mm apart = 5 holes**, 2.54 mm
  pitch. That matches the width Peter used on his own hand-built one.
- One column: `DIR STEP (pad3) (pad4) SPREAD MS2 MS1 EN`, top to bottom.
- The other: `VM GND OA2 OA1 OB1 OB2 VIO GND`, top to bottom.

The motor outputs are written in the **M-naming Peter's own board uses** — his net labels are
`M1A M1B M2A M2B` — mapped through the A4988-compatible footprint those pads occupy:
`OA2→M2B, OA1→M2A, OB1→M1A, OB2→M1B`.

**Pads 3 and 4 are unrouted in that source.** They are the positions the A4988 uses for `SLP`
and `RST`. They are named `NC3` and `NC4` and listed in `unverifiedPins`, which becomes a
**per-pin** list rather than the whole-device boolean it is now — 14 of these 16 names are
traceable and it would be a lie to mark them otherwise.

### JST XH — a connector, at a pitch that is not the board's

Peter: *"JST X connectors, right angle and straight, with pins from 2 to 8"*, series **XH**.

**XH is 2.5 mm pitch and the board is 2.54 mm.** Over 8 ways that is 0.28 mm of accumulated
error — under half a hole, so it solders in, and it is worth knowing rather than hiding. The
footprint is modelled at the **board's** pitch, because that is where the holes are, and the
part's own name carries the series so the difference is visible at the point of choosing.

Straight and right-angle are **separate devices**, not a parameter, because they are different
things to place: the right-angle's body lies over the board on one side of its pins, and where
it lies is a placement decision.

## The JST body — its own shape

Peter chose an outline of its own over reusing the pin header. `bodyFor` gains one `case`:

- the **shroud**, a rectangle around the pins, extended on the mating side;
- the **ramp**, the locking tab, drawn as a mark on the mating face — which is the thing that
  tells you which way round the connector goes, and the only reason to draw a connector rather
  than a box;
- **straight** puts the mating face on the pin row; **right-angle** offsets the body to one
  side, showing which way the cable leaves. That difference is the whole reason they are two
  devices, so the drawing has to show it.

## Reaching them: the Library card

`deviceList()` exists and returns exactly what a list needs. The Library card grows a
**Modules** group above the generic parts, and choosing one arms `place` with that device.
`placementFor()` already builds the placement.

A device whose `unverifiedPins` is non-empty shows **which** pins are unverified, on the
device in the library and in Focus once placed. A flag in a source comment is not a warning:
nobody reads the file while looking at a screen.

## Files

| file | change |
|---|---|
| `src/parts/devices.js` | XIAO, a sourced TMC2209, four JST entries; `unverifiedPins` becomes a list of pin names |
| `src/parts/library.js` | the `jst` base part and its `connector` category placement |
| `src/render/svg.js` | one `case` in `bodyFor` for the shroud and ramp |
| `public/app.js` | the Modules group in the Library card, and the unverified-pin warning |

## Explicitly NOT changed

- The rule that a placement copies the device and never references it.
- `dip`, `header` and every generic part.
- Pin numbering: down one side and back up the other, as `dipPins` already does.

## What a green run means

`tests/parts/test_devices.mjs` reports `N/N checks passed`:

- the XIAO is 14 pins, span 7, width 6, and its names are exactly the fourteen above in order;
- the TMC2209 is 16 pins, span 8, **width 5**, and its names are the sourced ones with the
  motor outputs in Peter's M-naming;
- `unverifiedPins` is a **list of pin names**, every entry of which is a real pin of that
  device, and the TMC2209's is exactly `NC3` and `NC4`;
- every JST is 2 to 8 ways, straight and right-angle are distinct, and a placed one carries
  one name per way;
- every device's pin count equals the pin count its footprint resolves to — the check that
  catches a name list drifting from the geometry;
- `placementFor` still copies names onto the placement, and a placed device still works when
  its catalogue entry is deleted.

Plus, in a real browser, both themes: each device placed from the Library, its pin names in
Focus, and the unverified pins named on the TMC2209.
