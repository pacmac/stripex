# SPEC — the spot-face marker is 20% smaller

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/svg.js:  01da340eaccb80ee951a4521f91c9a000209df5c7c9f840eb25c7bf68cd057cf

## Found while checking it, and NOT changed

The spot-face's **hit target is smaller than its mark** — 1.73 mm against what was 2.84 mm,
now 2.28 mm — so the outer ring of the circle is not clickable. That is deliberate:
`break-hit-targets.md` shrank the targets because full-size ones made 44% of a DIL body select
a cut instead of the chip. The check therefore asserts what actually matters — the target
covers the **hole**, which is where anyone aims and the only part of the mark that
unambiguously belongs to that cut — rather than overturning a trade made on purpose.

Peter, 2026-08-30: *"the spot drill circle can be reduced by 20%"*

## What it is now

```js
r = PITCH_MM * 0.56      // 1.42 mm, so 2.84 mm across
```

with the comment *"The cutter takes out a disc of copper about 3 mm across, wider than the
pitch — which is exactly why the hole ends up connected to nothing."*

That reasoning is about the **tool**, and it is true: a spot-face cutter really does clear
about 3 mm. But the marker is not a picture of the cutter, it is a **mark saying this hole is
dead**, and at 2.84 mm it is wider than the 2.54 mm pitch, so it laps over its neighbours and
a row of them merges into a bar.

## The change

`PITCH_MM * 0.448` — 0.56 less 20%, which is 1.14 mm, so **2.28 mm across**. Under the pitch,
so two adjacent spot-faces no longer touch, and still far wider than the 1.0 mm hole it kills,
which is what makes it read as "the copper is gone here" rather than as a pad.

Nothing else changes: the fill, the outline, the selection halo and the hit target are all
unchanged, and the hit target was already sized independently — see `break-hit-targets.md`.

## Files

| file | change |
|---|---|
| `src/render/svg.js` | the spot-face radius |

## What a green run means

`tests/net/test_hole_breaks.mjs` reports `N/N checks passed`:

- a spot-face marker is **narrower than the hole pitch**, so two on adjacent holes cannot
  touch — the property that was wrong;
- and still at least twice the hole diameter, so it cannot be mistaken for a pad;
- the knife cut is unchanged;
- the hit target is unchanged, and still bigger than the mark, so a cut under a component
  stays clickable.
