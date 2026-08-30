# SPEC — a net is selected, not merely highlighted

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/panels.js:  dea173a5b7e619a29638016c9a0e545f374480b24ae54e9430527c1770715072
  public/app.js:         3bc57c5592d4853647277e8ec5a62c3eeca6e2eb2a6c6c76665c4e2c46f7a8f1
  public/style.css:      a29f06b76145c5c5520cdedc00f1a603a96c113cc8fe53ea6fff10fd8c3f9c2b

Peter, 2026-08-30: *"when a strip / net is selected on the board, the focus in the right
panel should select nets, and the net selected on the board should also be selected in the
nets tab and vice versa"*

## What is wrong

Clicking a strip sets `state.highlightNet`, and that is all it does. The right panel stays
on whatever tab it was on, and the Nets tab marks nothing. Clicking a row in the Nets tab
highlights the strips but marks no row either. The two views of the same thing do not know
about each other.

Every other selectable object already does this: choosing a part, a wire or a break brings
**Focus** forward and marks its row. A net is the one selectable thing that does not.

## The fix, and why it is a deletion rather than an addition

`highlightNet` becomes **a kind of selection**:

```js
state.selection = { kind: 'net', ref: 'n3' }
```

and the highlight is *derived* from it:

```js
highlightFor(selection) -> selection.kind === 'net' ? selection.ref : null
```

The alternative — keeping `highlightNet` and *also* setting a selection — would be two
pieces of state that must agree, with nothing checking that they do. That is the shape this
project has already paid for twice: the ref-prefix table that drifted from the library, and
the palette highlight that drifted from the armed tool. One source of truth, derived at the
point of use.

## What then follows for free

- `focusTabFor` gains one line: a net selection opens the **Nets** tab, exactly as a part
  opens Focus.
- `markSelectedRows` already marks the row whose ref matches the selection, so the net's row
  marks itself.
- Clicking a net row sets the same selection, so the board highlights and the row marks —
  the "vice versa" half needs no separate code.
- `Esc` clears a net selection along with everything else, because it is now the same thing.

Clicking the same strip again clears the selection, as it did before.

## The Focus tab still has to answer

A net selection opens the Nets tab, so Focus is not what you are looking at — but it must
not read "Nothing selected" while something is. It describes the net: its name, its colour,
how many segments and connections it holds.

## Files

| file | change |
|---|---|
| `src/render/panels.js` | `highlightFor()`; `focusTabFor` handles `net`; `inspectorKey` handles `net` |
| `public/app.js` | one selection instead of two states; Focus describes a net |
| `public/style.css` | `.row.is-net-on` — the marked row wears the board's own `#ff6a00`, so the two views of one net look like one thing |

## Explicitly NOT changed

- The highlight's appearance, settled earlier: full opacity, `#ff6a00`.
- Net names and colours, which are edited in the Nets tab as they are now.
- Any other selection kind.

## What a green run means

`tests/render/test_net_selection.mjs` reports `N/N checks passed`: a net selection yields
its id from `highlightFor` and every other kind yields null; `focusTabFor` sends a net to
the Nets tab and a part to Focus; `inspectorKey` gives a net its own stable key that does
not collide with a part of the same ref; and a null selection still highlights nothing.

Plus, in a real browser, **both directions**: clicking a strip opens the Nets tab with that
net's row marked; clicking a row highlights that net's strips and marks the row; and
clicking the same strip twice clears both.
