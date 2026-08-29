# SPEC — two kinds of cut, copper-side parts, and packages that cut their own strips

status: implemented; three entries CLOSED, one open with its reason recorded
area: board-model, connectivity, component-library, editor-ui
source_hash:
  src/net/segments.js:   ad712562c969bbabc7730c9d77ad1125398ead8ae0a3a552a9fc184f8cb2a7d6
  src/model/board.js:    96515e67dddaa13e655bd9a65065851db0069a2517a3a5fa75293bf3c8e6a5f4
  src/model/breaks.js:   309bf4358a7769ea06eb2a4ce790209f27e51211b61cf6538a8b73e767d80736
  src/net/drc.js:        0bc86b0a5bdb18b7a3e60871ccb5498d8f5ac55d252cc97002b2e3fbb7b46090
  src/parts/library.js:  6a9a8736c8c9e7cb686ed99fb6e1b17f0e84406b8ad93a1a8145f69990f67d36
  src/render/svg.js:     40812370924308ce8df0545b4ad69e28e1fccfe2db993f265c12405a9498cdc7
  src/model/rotate.js:   d3d288f36e19446e7e5c85376606eb102bdcc452c46ae62531a1d0479b2bfa48
  public/app.js:         0d7f795edc79988acb768197579628ef4a2c6041288e4b2e69d4c45c21cec4e0
  public/index.html:     23ca7549874aac0a6715af1f696792e1f214d2b0b901c62bf5fcc2b158ecfa2c
  public/style.css:      e96c05201d6ffe3be96a311c8b15afb155b75a9f8eef1ad3c234339a89ef4289

## Results

| entry | red | green | closed |
|---|---|---|---|
| spot-face cuts | 6/14 | 14/14 | yes |
| copper-side mounting | 6/13 | 13/13 | yes |
| DIL cuts and width | 1/16 | 16/16 | yes |
| ref prefixes | 2/6 | 6/6 | **no — see below** |

8 suites, 151 checks, all green.

## Defects found while building this, and fixed

**The ref-prefix table was a second list.** Prefixes lived in a lookup table in `board.js`,
so the 0603 was added to the library and came out of the editor named `X1`. The prefix now
lives on the part, and `tests/parts/test_ref_prefixes.mjs` fails if any part lacks one —
the check exists because a list that must agree with another list, with nothing checking
it, is the defect rather than the symptom.

**Rotating a placed DIL left its cuts behind.** Placing cut the strips; turning did not, so
a rotated chip sat shorted pin-to-pin with its old cuts stranded elsewhere. Verified in the
browser: a DIP-14 now reports 0 errors at all four angles, cutting 12 strips on placement
and 5, 2 and 1 more as it turns. The stale cuts are deliberately kept — copper does not
un-cut itself when a part moves.

**A correctly cut DIL raised a warning per pin.** Cutting the strips under an IC is what
produces single-pin segments, so a properly built board showed 32 warnings. Findings now
fold by code above four instances. Errors are never folded: an error you have to click to
see is an error you will miss.

## Why the ref-prefix entry will not close

    src/model/board.js was not modified after the trial

True, and the register is right to refuse. I changed `nextPartRef` while exploring, then
wrote the test, then ran the trial — so board.js predates the red and cannot count as a
response to it. Only the `library.js` half of the fix landed afterwards.

This is the **second** time this session that an entry has failed to close for exactly this
reason (the first was `stripboard-has-no-model-or-connectivity`, over `geometry.js`). The
rule I keep breaking is the workflow's central one: the red comes first, and source stays
untouched until the entry is guilty. Recording it rather than amending the file list to
make the complaint disappear.

Peter, 2026-08-29: *"spot-face cutter at a hole, or knife between holes? both. and I also
need a SMT 0603 chip component that needs a knife cut between the poles. DIL packages need
built in breaks."*

Three changes. They are one task because they share a mechanism: the third is the first
two applied automatically.

---

## 1. Two kinds of cut

A break gains `at`, which is `'gap'` or `'hole'`. Absent means `'gap'`, so every project
saved before this change keeps its meaning.

### `at: 'gap'` — the knife

`{ row, x, at: 'gap' }` cuts the copper **between** hole `x` and hole `x+1`. Both holes
keep their copper. Valid `x` is `0 .. cols-2`. This is what the model already does.

### `at: 'hole'` — the spot-face cutter

`{ row, x, at: 'hole' }` is a drill or spot-face cutter applied **at** hole `x`. It removes
the copper in a circle around that hole. Valid `x` is `0 .. cols-1`.

> The consequence that makes this a different thing, not a relabelling: **the hole itself
> is dead.** A 3 mm cutter centred on a hole removes copper 1.5 mm each way, past the
> 1.27 mm midpoints to the neighbours on both sides. The strip is severed *and* the hole
> belongs to no segment at all.

So a spot-faced hole is not in `segmentIndex`, and a lead soldered there connects to
nothing. That is sometimes deliberate — a leg that is only mechanical support — so it is a
**warning**, `pin-on-dead-hole`, not an error.

Segment derivation:

| row of 10, breaks | segments |
|---|---|
| none | `0-9` |
| gap at 4 | `0-4`, `5-9` |
| hole at 4 | `0-3`, `5-9` — hole 4 in neither |
| hole at 0 | `1-9` only — no empty segment to the left |
| hole at 9 | `0-8` only |
| holes at 4 and 5 | `0-3`, `6-9` |

An empty run emits **no segment**. A zero-width segment would be a net with no holes in
it, which would show up in the net list as a phantom.

---

## 2. Copper-side parts, and the 0603

A part gains `side`, which is `'top'` or `'copper'`. Absent means `'top'`.

An SMT chip is soldered to the copper **on the underside**, straddling a cut. It does not
go through a hole. Two consequences:

- **A copper-side pad does not occupy its hole.** The hole stays free for a through-hole
  lead, and `hole-collision` must count top-side leads only. Flagging an SMT pad sharing a
  hole with a lead would flag a normal board.
- **The underside view must draw it.** That view currently drops every part body, which
  was right when every part was on top. A copper-side part is drawn solid underside and
  ghosted on the top view, because from the top it is under the board.

```js
'smt-0603': {
  kind: 'component', side: 'copper', requiresBreak: true,
  pins: [{ name: '1', dx: 0, dy: 0 }, { name: '2', dx: 1, dy: 0 }],
  body: { shape: 'chip', lenMm: 1.6, widMm: 0.8 },
}
```

The pads are modelled at holes `x` and `x+1` because that records **which segments the
part joins**, which is what the netlist needs. The body is drawn at its true 1.6 × 0.8 mm
centred on the cut — the drawing tells the truth about the size, and the model tells the
truth about the topology.

---

## 3. A DIL has a width as well as a pin count

Peter: *"DIL's have a width also in 0.1 pitch"*.

The `dip` part hardcodes `dy: 3`, so it can only ever draw a 0.3 in package. Real DIL comes
0.3 in (3 holes), 0.4 in (4), and 0.6 in (6) for the 24- and 40-pin devices. So a placement
carries **two** parameters:

```js
{ ref: 'U1', part: 'dip', span: 8, width: 6, at: {...}, rot: 90 }   // 16-pin, 0.6 in
```

`pinsOf(part, span, width)`, and a part declares `defaultWidth` / `minWidth` /
`widthLabel` alongside the span ones. `defaultWidth: 3` keeps every project saved so far,
and the existing "two rows 0.3 inch apart" check, correct without amendment.

The width does not change the break rule below — it only moves where midway is.

## 4. `requiresBreak` — packages that cut their own strips

A part declares `requiresBreak: true` when it cannot work unless the strip is cut between
its own pins. Two cases, one rule.

- A **DIL** package straddles the strips, so pin *n* and its opposite pin land on the same
  row and therefore the same strip. Every strip under the IC must be cut. A DIP-14 needs
  seven cuts.
- An **0603** has both poles on one strip and needs one cut between them.

```js
requiredBreaks(placement, getPart) -> [{ row, x, at: 'gap' }]
```

For each row carrying two or more of the placement's electrical pins, sort them by column
and, for each adjacent pair, emit a gap break midway between them:

```
x = floor((a.col + b.col - 1) / 2)      // a.col <= x < b.col, so the pair is separated
```

Placing such a part inserts these breaks. **They are ordinary breaks afterwards** — not a
special kind owned by the part — because a cut in a real board is permanent and does not
un-cut itself when you lift the chip off. The user can delete them like any other.

`missing-required-break` is a DRC **error** naming the exact gap to cut, raised when a
`requiresBreak` part still has two pins sharing a segment. It replaces the generic
`short-across-part` for these parts, because "R1 is shorted" and "you have not cut the
strip under U1 between holes 6 and 7" are different amounts of help.

---

## Files

| file | change |
|---|---|
| `src/net/segments.js` | `at: 'hole'` handling; no empty segments |
| `src/model/breaks.js` | **new** — `requiredBreaks()`, `normaliseBreak()` |
| `src/model/board.js` | validate `at`; wider `x` range for hole breaks |
| `src/net/drc.js` | `pin-on-dead-hole`, `missing-required-break`, side-aware collisions |
| `src/parts/library.js` | `side`, `requiresBreak`, the 0603, DIL marked |
| `src/render/svg.js` | draw hole breaks; copper-side bodies in the underside view |
| `public/app.js` | break tool picks gap or hole; auto-insert on placement |
| `public/index.html`, `public/style.css` | the cut-type control |

## Explicitly NOT changed

- Nets are still the connected components of segments joined by zero-ohm parts. A dead
  hole removes a vertex's membership; it does not change the rule.
- Auto-inserted breaks are not tracked as belonging to their part. Making them
  self-removing would model a board you cannot actually build.

## What a green run means

Three checks, one per change, each red before and green after:

- `tests/net/test_hole_breaks.mjs` — the segment table above, exactly; a dead hole is in
  no segment; a lead there warns rather than errors; `at` absent still means a gap.
- `tests/parts/test_smt.mjs` — an 0603 pad does not collide with a through-hole lead in
  the same hole; the underside view draws its body and the top view ghosts it; without a
  cut between its poles it raises `missing-required-break`.
- `tests/model/test_auto_breaks.mjs` — a DIP-14 across the strips yields seven breaks that
  clear all seven shorts; an 0603 yields one; the gap chosen always lies strictly between
  the pins it separates; a 0.6 in DIL puts its rows six holes apart and still needs exactly
  one break per row; `width` absent still means 3.
