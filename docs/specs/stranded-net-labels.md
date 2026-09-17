# BUG — a net name on a cut hole is invisible and cannot be cleared, and check ignores label problems

status: in progress
area: board-model

Three reports of one gap.

- **Peter's MS1.** On the Yagi V5 Control Board a name `MS1` is stored at (8,17), and that
  hole is spot-faced. The name is on no net, so it is not drawn, not in the Nets tab, and
  cannot be renamed or cleared from the editor.
- **`device`, 2026-09-17, `rakio-2-cam-top`:** `RX` at (5,5) under a later spot-face.
  `{"op":"setLabel","hole":{"col":5,"row":5},"name":""}` is refused with `dead-hole`: the
  guard that stops naming a dead hole also stops clearing one.
- **Two names on one net.** `netLabelProblems()` finds a net called both `0V` and `CLK` on the
  Yagi board. Nothing reports it: `GET /api/boards/:slug/check` merges the DRC, the rules
  and the disabled rules, but not the label problems.

## The change

**Label problems are findings.** `findingsFor(project)`, which the Checks tab and every
`check` endpoint use, now includes them:

| code | severity | when |
|---|---|---|
| `net-name-conflict` | warning | one net carries two different names |
| `net-name-stranded` | warning | a stored name is on a hole that is on no net: a spot-face removed it, or its strip carries nothing |

A stranded finding names the label and the hole by the edge labels (e.g. *"MS1 is at R9,
which a spot-face has cut away, so it names nothing"*) and carries the hole, so the Checks
tab can point at it.

**Warnings, not errors.** A stale name does not make the copper wrong. It makes the drawing
misleading, which is what a warning is for.

**It is not removed automatically.** The cut might be the mistake, not the name. Deleting
the name would lose the only record of what that hole was meant to carry.

**A clear gets through on a dead hole.** `setLabel` with no name and no colour removes the
stored label wherever it is. The dead-hole guard stays for naming: a name there would name
nothing.

**The Nets tab lists stranded names** under *Names on no net*, each with its hole and a
**Clear** button, so a name that cannot be seen can still be found and removed.

## Files

| file | change |
|---|---|
| `src/model/nets.js` | `netLabelProblems` reports stranded names too, with their hole |
| `src/model/views.js` | `findingsFor` includes label problems as warnings |
| `src/model/ops.js` | `setLabel` lets a clear through on a dead hole |
| `public/app.js` | *Names on no net* in the Nets tab, with Clear |

`src/server/index.js` needs no change: its check endpoints already call `findingsFor`.

## What a green run means

`tests/model/test_stranded_labels.mjs`:

- a name on a spot-faced hole is a `net-name-stranded` warning naming the name and the hole;
- a net with two names is a `net-name-conflict` warning in `findingsFor`;
- `setLabel` clears a name on a dead hole, and still refuses to set one there.

`tests/browser/test_stranded_labels_ui.mjs`: the Nets tab shows the stranded name under
*Names on no net*, and Clear removes it from the board.
