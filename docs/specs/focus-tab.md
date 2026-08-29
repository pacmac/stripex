# SPEC — selecting something brings it into focus

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/render/panels.js:  757b4092d6f7d1f7028b63022a8236d5e7bacd82c35df1e2923e8459f9151bf9
  public/app.js:         d25cdac5f14c241200b631093a4e511e84f522935a356723c0a91a26eb2eafae
  public/index.html:     546324d3bea512af863b00e2d3967c43c7b933a30f5f4b5b29ee7310f6477e25

## What the browser actually did

Red 0/9 → green 9/9, entry closed. 10 suites green.

Tab labels read `Checks, Nets, Run list, Focus`. Starting from the **Nets** tab each time,
so a pass could not be an artefact of already being on the right one:

| selected | tab afterwards | body shown |
|---|---|---|
| part R1 | Focus | `Ref R1 · Resistor (axial) · At 4,3 · Rotation 0° · Span 4` |
| wire W1 | Focus | `Wire W1 · From 2,10 · To 20,15` |
| break | Focus | `Knife cut · row 7 · Between holes 14 and 15` |

The two ways this could have been annoying rather than helpful, both checked:

- **Deselecting left the panel alone.** On Nets, pressed Escape, still on Nets.
- **An edit did not yank the panel back.** On Run list, cut a track, still on Run list.

No console errors.

Peter, 2026-08-29: *"when you select a component on the board, the "Selected" Tab should be
selected and the Tab name should be "Focus""*

## Two changes

1. The tab is called **Focus**, not "Selected".
2. Selecting something on the board switches to it, so the details are in front of you
   rather than one click away behind whichever tab you happened to leave open.

## The tab list becomes data

The tabs are currently hardcoded in `index.html` and their bodies keyed by id in
`app.js` — two lists that have to agree, with nothing checking them. That exact shape has
already cost this project once today: reference-designator prefixes lived in a table in
`board.js`, drifted from the library, and shipped a part called `X1`.

So the list moves to `src/render/panels.js`:

```js
export const TABS = [
  { id: 'findings', label: 'Checks' },
  { id: 'nets',     label: 'Nets' },
  { id: 'runlist',  label: 'Run list' },
  { id: 'inspect',  label: 'Focus' },
];
```

`app.js` builds both the tab bar and the bodies from it, and node can check the labels.

## When it switches

```js
focusTabFor(selection) -> tab id, or null for "leave the tab alone"
```

| selection | result |
|---|---|
| a part | `'inspect'` |
| a wire | `'inspect'` |
| a break | `'inspect'` |
| nothing | `null` |

> Peter said "a component". **A wire and a break switch too.** They are selectable, the
> Focus tab is what describes them, and a selected wire leaving the panel showing Checks
> is the same fault he is reporting. Said here so it can be pushed back on.

**Deselecting does not switch back.** Clicking empty board would otherwise yank the panel
away from whatever you were reading, and clearing a selection is not a request to change
what you are looking at.

Switching is not the same as clicking the tab: the user's own tab choice is only overridden
when a *new* selection arrives, never on a redraw. A redraw happens on every edit, and a
panel that jumped back to Focus every time you cut a track would be unusable.

## Files

| file | change |
|---|---|
| `src/render/panels.js` | **new** — `TABS`, `focusTabFor()` |
| `public/index.html` | the tab bar and bodies become empty containers |
| `public/app.js` | build tabs from `TABS`; switch on a new selection |

## Explicitly NOT changed

- What the Focus tab contains. Only its name and when it comes forward.
- The other three tabs' behaviour.

## What a green run means

`tests/render/test_panels.mjs` reports `N/N checks passed`: the inspect tab is labelled
`Focus`; nothing is labelled `Selected`; tab ids are unique; every kind of selection maps
to `inspect`; no selection maps to `null` rather than to a tab id, so deselecting cannot
move the panel.

Plus, in a real browser: select a part, a wire and a break in turn from a different tab
each time, and confirm the panel comes to Focus and shows that object.
