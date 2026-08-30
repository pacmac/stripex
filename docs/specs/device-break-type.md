# SPEC — a device declares how its strips are cut

status: implemented, entry CLOSED
area: component-library, board-model
source_hash:
  src/parts/library.js:  0b24af93b1f91fd5b880e711502da0b646e0174f3d61afe4c49eedd64029266b
  src/model/breaks.js:   84f09fb3928b8d0f394fc5650d259fd90a52e7feba2ff39b36db70e07264e749

## What the browser actually did

Red 8/13 → green 13/13, entry closed. 12 suites, 196 checks.

A 0.3 in DIP-14, turned between the two orientations:

| orientation | spot-faces drawn | knife cuts drawn | errors |
|---|---|---|---|
| straddling the strips | **7** | 0 | 0 |
| lying along the strips | 0 | **12** | 0 |
| straddling again | **7** | 0 | 0 |

The fallback is visible in the middle row: the same device, declared `spot-face`, cuts with
a knife when its pins are adjacent and there is no hole to drill.

## Two existing checks that had to be corrected

The change is deliberate, so two suites failed on assertions that stated the old rule.
Both were rewritten to state the new one, and neither was weakened:

- `auto-breaks` asserted every required cut is `at: 'gap'`. Now asserts `at: 'hole'` for a
  straddling DIL, with a pointer to this spec.
- `owned-breaks` matched a user cut against a derived one by row-x-**and-kind**. A DIL's
  derived cut is now a spot-face while the user's is a knife cut, so the match is on place
  alone — which is what `effectiveBreaks` has always deduplicated on. The check now also
  asserts the surviving cut is the user's `gap`, which it did not before.

Peter, 2026-08-30: *"also dip deices should use spot face and not knife cut breaks."*
then: *"so I think that a device needs a break_type param: knife/spot-face"*

## The parameter

A part gains `breakType`, one of `'knife'` or `'spot-face'`. Absent means `'knife'`.

| part | breakType | why |
|---|---|---|
| `dip` | `spot-face` | there are holes between the two pin rows; you drill one out |
| `smt-0603`, `smt-0603-cap` | `knife` | the pads are adjacent, so there is no hole to drill |
| everything else | `knife` (default) | they declare no required cuts at all |

It is declared rather than inferred from pin spacing. Inferring would be quietly clever and
would give the right answer for both parts in the library today, but it would also mean a
part could never ask for a knife cut where a hole happens to be available — and the person
who knows which tool they are going to pick up is the one holding it.

## The constraint that a declaration cannot override

A spot-face cut is made **at a hole**, so it needs a hole strictly between the two pins it
separates. Adjacent pins have none.

> When a `spot-face` part has two pins in adjacent holes, the cut **falls back to a knife
> cut** in the gap between them.

This is not a nicety. A DIL straddling the strips has its pin rows 3, 4 or 6 holes apart
and can be spot-faced. The same DIL turned to lie **along** the strips has adjacent pins in
each row, where a spot-face is physically impossible — and that is a real orientation the
editor allows. Refusing to emit a cut there would leave the package shorted with no cut
shown; emitting a hole cut at a pin would drill out a hole with a leg in it.

So: use a spot-face where one will fit, a knife cut where it will not.

## Which hole, which gap

For an adjacent pair of same-row pins at columns `a` and `b` (`a < b`):

```
spot-face, and b - a >= 2  ->  { at: 'hole', x: floor((a + b) / 2) }   // strictly between
otherwise                  ->  { at: 'gap',  x: floor((a + b - 1) / 2) }
```

Both land midway, which keeps the cut clear of the legs either side.

A worked case — a 0.3 in DIL straddling the strips, pins at columns 6 and 9:
`floor(15 / 2) = 7`, and `6 < 7 < 9`. Hole 7 is drilled out, the strip is severed, and the
hole is dead — which is correct, because nothing is soldered there.

## Files

| file | change |
|---|---|
| `src/parts/library.js` | `breakType` on the parts that require cuts |
| `src/model/breaks.js` | `requiredBreaks` honours it, with the adjacency fallback |

## Explicitly NOT changed

- The break record shape. A cut is still `{ row, x, at: 'gap' \| 'hole' }`; `breakType` is
  the *part's* vocabulary and maps onto it. Two names for one idea is a cost, but renaming
  the stored field would break every project already saved.
- Per-placement override. The parameter is on the device, as asked. A placement-level
  override is a small addition later if it turns out one board wants it.
- The user's break tool, which already offers both and is unaffected.

## What a green run means

`tests/parts/test_break_type.mjs` reports `N/N checks passed`: `dip` declares `spot-face`
and the 0603s declare `knife`; a straddling DIL's cuts are all `at: 'hole'` and each sits
strictly between the pins it separates; **the same DIL turned along the strips falls back to
`at: 'gap'`**, because its pins are then adjacent; an 0603 is always a knife cut; and in
every orientation the cuts still clear every short.
