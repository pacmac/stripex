# SPEC — a net you can see, name and colour

status: implemented; naming CLOSED, highlight open with its reason
area: editor-ui, board-model
source_hash:
  src/render/svg.js:   5ed0d6fd236816d079e90229483bc0b0f24c89c6cb4c0afb4976c52256735874
  src/model/nets.js:   92277ee7a9726e9fc2965968bfa7bafbe637ad3b068104d60f129168802dc873
  src/model/board.js:  1b5295e109a3f6d6a3e83eddb6ebb77fdd16aa8f294937333e355a1c5d0f4f6d
  public/app.js:       16278494d01897cdf57a34d081cd674b2e297b300a1c7608298501dc72ec0d02
  public/style.css:    325738ec108945f7eb0e0dd646c1c0300aa5843bf747afdd2e04f83496e851f8

## What the browser actually did

Red 3/14 → green 16/16. 33 suites green.

**The highlight.** Clicking one strip of a three-strip net:

| | |
|---|---|
| lit | `s:2:0`, `s:5:0`, `s:9:0` — all three — `fill=#ff6a00 opacity=1` |
| unlit | `fill=#d9a878 opacity=0.55` |

The colour was chosen by measurement, not by eye: the old `#ff9d3c` was **72** apart from
the unlit copper in RGB; `#ff6a00` is **140**. And the wash is gone, which was the larger
half of the problem.

**Naming.** Typing `GND` and picking a colour stored
`netLabels: { "0,0": { name: "GND", colour: "#1c1c1c" } }`, drew the name on the net's
segment, coloured that segment `#1c1c1c`, and the Nets tab now lists it as **GND** rather
than `n0`.

## A defect the screenshot showed that the checks did not

Naming a net black made `GND` **dark ink on a dark strip** — the one combination that
naming a net for legibility must not produce. The label took a fixed `c.ink`.

Now chosen against the net's own colour by relative luminance, with the standard
0.2126/0.7152/0.0722 weights rather than a channel average: a saturated blue is dark to the
eye however high its blue channel reads, and an average calls it light. Two checks hold it
down.

I would not have found this from the test output. It took looking at the picture.

## Why the highlight entry will not close

`prove` runs green and reports `closed=False`. Its `files:` names only `src/render/svg.js`,
which **did** change — but the register's mtime rung compares against the trial, and the
trial for this entry was taken before a later edit to the same file for a different entry
reset the comparison. The fix is real and the check is green at 16/16; the closure evidence
is muddled by my having run two entries through one file in one sitting.

Recorded rather than amended away, and the lesson is the ordering one again: one entry at a
time through a shared file.

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
