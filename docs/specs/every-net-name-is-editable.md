# SPEC — every name on a net has a field

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/model/nets.js:  fc596f944b45f90c8509493c636e533043e229119b88df59bbafc943386135f0
  public/app.js:      c0f62b68ea09b43e2095a55f96df5460be0f77f232400afd0124785fd536d6f6

Peter, 2026-08-30: *"I cannot rename a NET"* — with his board attached.

## What is actually wrong

Renaming works. Typing a new name into a net's field and pressing Enter renames it, on an
empty board and on his: `0V` → `GROUND` renames, saves and redraws. So the general path is
not the fault, and saying "renaming is broken" would have sent the fix to the wrong place.

**One of his twelve names has no field at all.** Measured on the board he pasted:

```
27 nets | 12 labels stored | 11 resolve to a net | 1 unreachable
banner: "one net is called both 0V and 3V3"
```

`netLabels["6,5"] = {name: "3V3"}` is stored, and hole 6,5 is on the **same net** as hole
0,0, which is called `0V` — the links `L4`, `L5` and `L7` join them, and the board is right
about that. But:

```js
if (!out.has(netId)) out.set(netId, { ...label, hole });   // netLabelsByNet
```

**First label wins, and the rest do not exist as far as the UI is concerned.** The Nets tab
draws one row per net with one field, holding the first name. `3V3` is therefore:

- not shown on any row,
- not in any input, so it cannot be renamed,
- not clearable, because clearing is done by emptying the field it does not have,
- and permanent — every future rename of that net edits `0,0` and leaves `6,5` untouched.

The banner reports the clash and offers no way to act on it. It is the one thing on this
screen that names a problem the user cannot reach.

## Why the model is right and the view is wrong

A name is anchored to a **hole**, deliberately — `src/model/nets.js` explains why a net
cannot own its name: `n0` means "the net holding the top-left-most segment", so a name stored
against a net id would jump to a different net the moment a wire is added.

So **a net may legitimately carry several names**, and two of them disagreeing is a real
finding about the board — here, that Peter believes 3V3 and 0V are separate and they are not.
Resolving it by silently dropping one hides exactly the fact he needs. The view has to show
what the model holds.

## The fix

`netLabelsAllByNet(project, segmentNet)` — netId → **every** label on that net, in stored
order. `netLabelsByNet` is unchanged and still answers "the name of this net" with the first,
because the board draws one plate per net and the strip has one colour.

The Nets tab then renders **one field per stored label**, each carrying its own hole anchor,
so each can be renamed or cleared on its own. A net with no labels keeps exactly one empty
field, anchored to the net's first hole, which is how a name is added today.

The row's own heading shows every name it holds, joined — `0V · 3V3` — so the clash is
visible without reading the banner.

## Files

| file | change |
|---|---|
| `src/model/nets.js` | `netLabelsAllByNet()` |
| `public/app.js` | one field per label; the row heading lists them all |

## Explicitly NOT changed

- `netLabelsByNet`, and everything that draws from it: one plate per net, one strip colour.
- The hole anchoring, which is the reason this situation exists and is correct.
- `netLabelProblems` and its banner. It was telling the truth; it just had nowhere to send you.
- `setNetLabel`, which already keys on a hole and needs nothing.

## What a green run means

`tests/render/test_net_labels.mjs` reports `N/N checks passed`:

- `netLabelsAllByNet` returns **both** names when two labelled holes are on one net, in stored
  order, each with the hole it is anchored to;
- it returns one for an ordinary net, and nothing for an unnamed one;
- a label on a spot-faced hole, which belongs to no segment, is still dropped;
- `netLabelsByNet` still returns exactly the first label, unchanged;
- and on **Peter's board specifically**, every one of the twelve stored labels is reachable —
  the case that produced this, as a permanent regression check.

Plus, in a real browser, on his board: `3V3` appears in a field of its own on the `0V` row,
and can be renamed and cleared.
