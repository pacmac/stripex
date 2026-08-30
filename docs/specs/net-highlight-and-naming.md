# SPEC — a net you can see, name and colour

status: draft
area: editor-ui, board-model
source_hash: (set in Phase 5)

Peter, 2026-08-30: *"when I select a strip, it's net / strip gets highlighted, but it needs
to be a bit darker contrast, and I noticed the the net / selected / highlighted only flows
in 1 direction, and does not select all connected strips."*
then: *"nets need a colour picker and a editable name."*

## The "one direction" report is a contrast problem, and here is the evidence

The derivation is right. Built a chain of three pen wires across four strips and highlighted
the net containing row 0:

```
nets: 5      (8 strips, 3 wires)
lit:  s:0:0 s:2:0 s:4:0 s:6:0      — all four, not one
```

Same through wire links. And a resistor correctly does **not** merge its two strips, which
is the impedance rule the whole model is built on — if that is what was tried, the highlight
not flowing is the tool being right.

What is wrong is that you cannot see it:

```
lit    fill="#ff9d3c" opacity="0.55"
unlit  fill="#d9a878" opacity="0.55"
```

The top view washes copper to 0.55 because it is under the board. The highlight inherited
that wash, so the orange arrives as pale peach on a tan ground. The strip under the pointer
reads as lit; ones further off do not register, and the net looks like it stopped.

**A highlighted segment is not "copper seen through the board" — it is an answer to a
question.** It gets full opacity and a stronger colour, and the unlit wash stays as it is.

## Names and colours

A net cannot own its name, because **a net has no stable identity**. `n0` means "the net
containing the top-left-most segment"; add one wire and the numbering shifts, so a name
stored against `n0` would jump to a different net.

So a name is anchored to a **hole**:

```js
project.netLabels = { "4,7": { name: "GND", colour: "#1c1c1c" } }
```

read as *"the net that hole (4,7) is on is called GND"*. That survives every edit that does
not destroy the hole — cutting the strip, moving a part, adding wires — and when it does
break, it breaks visibly: the label is simply on whatever net that hole now belongs to,
which is the truthful answer.

Anchoring to a segment id would not do: `s:3:1` is the second segment of row 3, and cutting
row 3 further left renumbers it.

- Naming a net gives it a name **and** a colour, either optional.
- A named net draws its name on each of its segments, and takes its colour instead of the
  copper colour — so `GND` in black across the board is visible without selecting anything.
- Two holes on the same net must not carry different names: the check reports it rather than
  picking one.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | full-opacity highlight; draw net names and colours |
| `src/model/nets.js` | **new** — `labelFor()`, `setNetLabel()`, `netLabelProblems()` |
| `src/model/board.js` | validate `netLabels` |
| `public/app.js` | name field and swatches on the Nets tab |

## Explicitly NOT changed

- Net derivation, which the evidence above shows is correct.
- The `n0`, `n1` ids, which stay as the internal handle. A name is a label on top.
- The unlit copper wash, which is right: unlit copper *is* under the board.

## What a green run means

`tests/render/test_net_labels.mjs` reports `N/N checks passed`: a highlighted segment is
drawn at full opacity while unlit ones keep the wash; the lit colour differs from the unlit
one by a wide margin; a chain of three wires lights all four strips; a label anchored to a
hole is found from any segment of that net; adding a wire that renumbers the nets keeps the
name on the same copper; a named net draws its name on every segment and takes its colour;
two conflicting names on one net are reported; and a label whose hole no longer exists is
ignored rather than throwing.
