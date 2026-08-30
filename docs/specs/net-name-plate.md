# SPEC — a net name needs a ground of its own

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  2c04a40a8732955b1d4180fcbe4a2455dfcf730caa07e4e4f744dca91525d223
  public/app.js:      082442236e96e19ad9a5d1909d12b880d1bfc77b435fc75218487405c7bb2920

Peter, 2026-08-30: *"the NET name, needs to have a background (opage) as it gets positioned
over holes and much of the text is lost. this needs to be done tastefully."*

Peter, 2026-08-30: *"and net names needs to be a layer"*

## What is wrong

The name is drawn inside the copper pass — step 2 of nine in `renderBoard` — and the holes
are step 4. So every hole on the strip is painted **on top of** the letters, at
`c.hole` (`#0d0b07` dark, `#3a3226` light), 1.0 mm across on a 1.4 mm typeface. A name
lands on two or three of them and comes back as fragments.

There is a second fault underneath it, and it is why "just move the text later" is not the
whole fix. On the top view the copper is drawn at **0.55 opacity**, so what the eye sees is
not `fill` but `fill` blended with the substrate. The ink is chosen by
`readableOn(label.colour ?? fill, c)` — against the *unblended* colour. The ink is picked
for a colour that is not on screen.

An opaque plate fixes both: the letters get a clean ground, and the ground is exactly the
colour the ink was chosen against, so `readableOn` starts telling the truth.

## The plate

A pill behind the text, in the segment's **own** colour at full opacity — not a badge in
some new colour. It should read as a solid patch of that strip, not as a sticker on top
of it.

| | value | why |
|---|---|---|
| fill | the segment's `fill`, opacity **1** | same hue as the strip, so it belongs to it; opaque, so the holes stop showing through |
| height | `TRACK_W_MM * 0.92` (1.84 mm), centred on the strip | never pokes into the 0.54 mm gap, so it cannot be mistaken for copper bridging two rows |
| radius | `h / 2` — a pill | a rounded plate reads as annotation; a square one reads as a pad |
| stroke | the ink at 0.22 opacity, 0.08 mm | the hairline weight the holes already use. On the underside view the strip is already opaque, so without an edge the plate is invisible — the name would float with no shape |
| width | estimated text width + **half an em of clear space each end** | there is no text metric in a renderer with no DOM |

**The estimate is `0.62 × fontSize × length`** — sans-serif at weight 600 averages near
0.6 em. It is an estimate, and the padding is what absorbs the error.

Peter, 2026-08-30: *"needs a little bit of left / right padding at start / end of net name/
label"*. The padding is **in em, not millimetres**: a fixed pad looks generous at full size
and cramped the moment the font shrinks to fit a short segment — which is precisely where the
letters are already tightest against the ends. So the whole plate is one multiple of the font
size, `fontSize × (0.62 × length + 1.0)`, and the fit inverts exactly instead of being solved
by trial.

### A name that does not fit its segment

Clamping the plate and letting the text spill would reproduce the exact defect being fixed:
letters back over the holes, now with a plate drawing attention to them.

So the **font shrinks to fit** the segment, and below `PITCH_MM * 0.3` (0.76 mm) the name is
**dropped for that segment**. Dropping one is safe because the name is drawn on *every*
segment of the net — a two-hole stub loses its caption while the run across the board keeps
it, and the Nets tab names it regardless.

## Draw order

A new pass, **after the holes and before the pen wires**:

```
1 substrate  2 copper  3 breaks  4 holes  [4b net names]  5 wires  6 components  …
```

Wires and components stay on top on purpose. They are objects on the board; the name is
annotation *of* the board, and a link that crosses a labelled strip has to be visible where
it lands. Component bodies are 0.16 fill-opacity silkscreen, so a name under one still reads.

## Its own layer

Net names currently ride on `labels`, which is *"Refs and values"* — R1, 10k, the letter on
a pen wire. Those name the **parts you placed**. A net name is the opposite: nothing placed
it, it is derived from where the copper runs, and it repeats on every segment of its net.
Being able to switch off the captions without also losing every part reference is the whole
point of a layer.

- `DEFAULT_LAYERS` gains `netNames: true`, so a project saved before this opens with them on.
- `LAYER_ROWS` in the editor gains `['netNames', 'Net names', …]`, placed after **Holes** —
  where the new pass sits in the drawing.
- The plate and the text both obey it. Nothing else moves off `labels`.

## The arithmetic is a function, not a regex

`namePlate(name, segWidthMm, baseFontMm)` returns `{ show, w, h, fontSize }` and is exported,
so the sizing can be checked as arithmetic in node rather than by pattern-matching an SVG
string. `readableOn` is already exported for the same reason.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | `namePlate()`; the net name moves out of the copper pass into its own pass after the holes, with a plate behind it; `DEFAULT_LAYERS.netNames` |
| `public/app.js` | the `Net names` row in the Layers card |

## Explicitly NOT changed

- Where the name sits — the middle of each segment it covers, as now.
- Which nets get a name, and how names are edited. That is `src/model/nets.js` and the Nets
  tab, untouched here.
- The net colour applied to the strip itself.
- The highlight: a lit net's plate takes the lit colour with everything else, and the
  highlight's own appearance is settled.

## What a green run means

`tests/render/test_net_name_plate.mjs` reports `N/N checks passed`:

- **the plate is drawn after every hole** and immediately before its own text, in the emitted
  SVG — the ordering that is the defect;
- the plate carries **no opacity below 1**, on the top view where the copper is 0.55;
- the plate's fill is the segment's fill, and the ink is `readableOn` of that same colour;
- the plate never exceeds the segment it belongs to, and never exceeds `TRACK_W_MM`;
- a long name on a short segment shrinks rather than spills, and vanishes rather than
  shrinking past illegibility;
- an unnamed net draws neither plate nor text;
- **`netNames: false` suppresses both, and `labels: false` no longer does** — a part
  reference and a net caption are now independently switchable;
- `netNames` defaults to on, so a project saved before the layer existed opens with its
  names visible.

Plus, in a real browser, both themes: a named net reads cleanly across the holes.
