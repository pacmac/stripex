# GAP — polarity is never checked anywhere

status: in progress
area: board-model

Registered as `polarity-is-never-checked-anywhere`: *"An LED with its anode on the 0V net and
a polarised capacitor with + on 0V both pass every check in the project. The LED on the first
555 board was in backwards and only reading which net each pin landed on caught it."*

A netlist states connectivity, not direction, so nothing could see it.

## What can honestly be known

Potential is not in the model. **Net names are**, and some names settle the question:

- **ground**: a net named like `0V`, `GND`, `AGND`, `DGND`, `VSS`;
- **supply**: any other name the power patterns match (`VCC`, `VDD`, `VIN`, `+5V`, `3V3`,
  `VMOT` …), the same `netClasses.power` list the rules already use.

## The rule

`polarity-reversed`, a **warning**, for a polarised part: its **positive** pin (`+`, or `A`
for an anode) and its **negative** pin (`-`, or `K`):

- the positive pin is on a **ground** net, or
- the negative pin is on a **supply** net.

The message names the part, the pin, the net, and that it was judged by the net's name. A
warning, not an error, because it is inferred from a name. It is silent where a net has no
name, because there is nothing to judge by.

Polarised parts are the ones whose pins are named that way: the electrolytic (`+`/`-`), the
LED and the diode (`A`/`K`). Pins are identified by the part's own pin names, not a device's
renamed ones.

## Files

| file | change |
|---|---|
| `src/model/rules.js` | the check, in `checkRules` |

## What a green run means

`tests/model/test_polarity.mjs`:

- an LED with its anode on `0V` warns; the right way round it does not;
- an electrolytic with `-` on `VCC` warns; with `+` on `+5V` and `-` on `GND` it does not;
- a diode with its cathode on `GND` and anode on a signal does not warn, and with its anode on
  `GND` it does;
- with its nets unnamed, a reversed LED is silent.
