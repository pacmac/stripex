# SPEC — the pen pad carries its own ID

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  cbfe7322522cf428bb07c2dfe18eb2852761e74c752c5f9a1708d6c51907dd4e

Peter, 2026-08-30: *"with the point to point, the points need to be a little larger and the
ID "A,B" etc needs to be a little smaller and inside the circle."*

## What is wrong

A pen wire is drawn as two pads sharing an ID and no line — that is the whole design, and it
means **the pad and its ID are one object**, not a marker with a caption. They are currently
drawn as two:

| | now | why it is wrong |
|---|---|---|
| pad radius | `PAD_R_MM` = `PITCH * 0.34` = 0.864 mm | the same radius as a component pad, which is a different thing entirely — a component pad is an outline round a hole, a pen pad is the wire end itself |
| ID | `PITCH * 0.6` = 1.524 mm, **above** the pad | larger than the pad it names, floating in the gap between rows where it collides with the row above and with the next wire's ID |

Two pen wires ending on vertically adjacent holes put one wire's ID on top of the other
wire's pad. And the letter carries the identity here — with no line drawn, `A` next to `A` is
the *only* thing saying those two holes are joined.

## The fix

The ID goes **inside** the pad, so one mark carries both.

| | value | why |
|---|---|---|
| pen pad radius | `PITCH * 0.45` = 1.143 mm | 2.29 mm across on a 2.54 mm pitch — as large as it can be while two pads on adjacent holes still show 0.25 mm of daylight between them |
| ID size | `PITCH * 0.42` = 1.067 mm | two characters at 0.62 em is 1.32 mm inside a 2.29 mm circle, so `AA` fits with room each side |
| ID position | centred on the pad | one object, not a marker and a caption |
| ID colour | `readableOn(pad)` | it now sits ON the length colour. A fixed ink is invisible the moment the wire is the black one — and black is 0 in the colour code, so it is the *first* wire anyone draws |

`wire.silk`, when the user has set one, still wins — it is an explicit choice and this is not
the place to overrule it.

**A NEW CONSTANT, `PEN_PAD_R_MM`, not a change to `PAD_R_MM`.** `PAD_R_MM` is the component
pad and is used by the component pass, the break markers and the DRC ring; growing it would
move all of those. The two radii being equal today is a coincidence, not a relationship.

The pending-wire marker takes the new radius too: it is a preview of the pad you are about to
place, and a preview that is the wrong size is a lie about what you are doing.

The `value` label stays **below** the pad, where it was. It is optional, usually absent, and
has no chance of fitting inside.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | `PEN_PAD_R_MM`; the wire pad, the ID and the pending marker use it |

## Explicitly NOT changed

- `PAD_R_MM` and every component pad, break marker and DRC ring that uses it.
- The pads staying identical at both ends: a pen wire has no direction.
- The length-derived pad colour, which says which pre-cut wire to take from the drawer.
- Wire **links** — a different object, drawn in the component pass, with a line of its own.

## What a green run means

`tests/render/test_point_to_point.mjs` reports `N/N checks passed`, with new checks:

- a pen pad is larger than a component pad, and small enough that two on adjacent holes do not
  touch;
- the ID is smaller than the pad's diameter and its box fits inside the circle;
- the ID is centred on the pad — same `x`, and a `y` within the circle rather than above it;
- the ID is readable against the pad it sits on, including when the wire is the black one;
- an explicit `silk` colour still wins;
- the pending marker matches the pad it previews.

Plus, in a real browser, both themes: `A` and a two-letter `AA` both sit inside their pads.

## One existing check changes its assertion

`tests/parts/test_point_to_point_part.mjs` asserted the ID takes **the theme ink** by default.
That was correct while the ID floated on the board above its pad, and is wrong the moment it
sits on the pad — it is the black-on-black case. The check is **amended, not deleted**: the
default becomes `readableOn(pad fill)`, and its second half, that an explicit `silk` still
wins, is untouched.
