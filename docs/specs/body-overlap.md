# BUG — two part bodies in the same place are not reported

status: in progress
area: board-model

Registered as `nothing-catches-two-part-bodies-in-the-same-column`: *"a resistor spanning
rows 4-9 and a capacitor spanning 6-8 in the same column pass the DRC, the rules and the
netlist check. I avoided it by hand on every layout this session."*

## The rule

`bodies-overlap`, an **error**: two placements **on the same side of the board** whose
**pin rectangles** share area. The pin rectangle is the box from a part's lowest to highest
column and row among its electrical pins.

- **The pin rectangle, not the drawn body.** It is conservative: a right-angle connector's
  shroud past its pins is not counted, so a layout that sits close to one is not flagged. A
  missed overlap is possible; a false one on a working board is not.
- **Wire links are excluded.** A link lying under a chip or between a resistor's legs is
  what links are for.
- **The side comes from the placement** (`sideOf(part, placement)`), so a part moved to the
  copper side does not collide with a top-side chip above it.
- **Touching is not overlapping.** Two resistors end to end in one column, or side by side
  in neighbouring columns, share no area.

## Files

| file | change |
|---|---|
| `src/net/drc.js` | the rule |

## What a green run means

`tests/net/test_body_overlap.mjs`:

- a resistor over rows 4–9 and a capacitor over 6–8 in one column is one error naming both;
- a resistor standing inside a DIP's footprint is an error;
- end to end, side by side, a link under a chip, an 0603 on the copper side under a top-side
  chip, and two parts on opposite sides are not.
