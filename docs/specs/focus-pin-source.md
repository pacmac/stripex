# GAP — the Focus panel does not say where a pin name came from

status: in progress
area: editor-ui

Registered as `the-focus-panel-does-not-say-where-a-pin-name-came-from`. A placement made from
a device carries `pinSource` (where its pin names came from) and `unverifiedPins` (the ones
nobody could source), and the board draws the doubt. Focus, where a person reads a selected
part, said neither.

## The change

When the selected part carries them, Focus shows, under the part's name:

- **Pin names from** — the source, in full, e.g. *SilentStepStick v2.0 board file, nets in
  pad order — except NC3/NC4 …*;
- **Unverified** — the pins, named, in the warning colour, e.g. *NC3, NC4*, with *check these
  against the part before wiring to them*.

A part with neither shows nothing extra: there is nothing to say.

## Files

| file | change |
|---|---|
| `public/app.js` | the two lines in Focus |

## What a green run means

`tests/browser/test_focus_pin_source.mjs`: a TMC2209 placed from the catalogue shows its
source and NC3, NC4 as unverified in Focus; a plain resistor shows neither.
