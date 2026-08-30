# SPEC — the design rules are configurable by the person they constrain

status: implemented, entry CLOSED
area: editor-ui
source_hash:
  src/model/rules.js:    4f99284cb09f8b2129a0cbf3f4d3f86858523da73041d6e1b7c3bd4cb4ae8d4d
  src/model/ops.js:      01d8f76306241817bb1baea9efa6fd59807be6666cbe9a40e5a738c524056233
  src/render/panels.js:  cf58af35c61d6eeed4f999cdd94ec8eb7bd6e838e0471373eb0989ee6968838e
  public/app.js:         6a31630441d81310023c756c8913492f7eada022e23cd4d7664f947765c4b390

Peter, 2026-08-30: *"then we will need a simple design rules. i/e wire links can only be
straight, point to point can be anywhere for signals only. power lines must be wire links, and
probably laid in first. **this list will grow so it needs to be configurable.**"*

## What is wrong

The rules are data on the project and `rulesFor(project)` merges an override, so they are
configurable **by a program**. There is no way for Peter to configure them:

- no card, no field, no control anywhere in the editor — `grep -n rules public/index.html`
  returns nothing;
- his board carries no `rules` key at all, so what governs it is whatever `DEFAULT_RULES` says
  today;
- and the only way to change one is to hand-edit JSON or drive the API.

He asked for configurable and got overridable. Those are different words.

**And "this list will grow" is the harder half.** Three checkboxes typed into the markup would
satisfy today's rules and would have to be typed again for the fourth rule, which is how the
two-lists-that-must-agree defect gets built on purpose. `TABS` and `CARDS` are already data in
`src/render/panels.js` for exactly this reason.

## The change

**`RULE_DEFS` in `src/model/rules.js`** — one entry per rule, beside the rule it describes:

```js
export const RULE_DEFS = [
  { id: 'linksAreStraight', kind: 'boolean', label: 'Wire links are straight',
    help: 'A link runs along a strip or across it, never diagonally.',
    enforcedBy: 'ops.addLink' },
  { id: 'penWiresFreeHolesOnly', kind: 'boolean', label: 'Point to point is hole to hole',
    help: 'A pen wire ends in a free hole, never one that already has a pin in it.' },
  { id: 'penWiresSignalsOnly', kind: 'boolean', label: 'Power goes by wire link',
    help: 'Refused over the API; warned at the mouse.', warnsOnly: 'editor' },
  { id: 'netClasses.power', kind: 'patterns', label: 'Power net names',
    help: 'A net whose name matches one of these is power.' },
];
```

**The Rules card renders from that list**, so adding a rule to `rules.js` gives it a control
with no second edit. That is what "configurable" has to mean for a list that grows.

`ops.setRules(project, patch)` writes them, validated against `RULE_DEFS`: an unknown rule id is
refused by name rather than stored, and a bad regex is refused with the regex, because a rule
that throws when it runs is worse than one that is off.

**A rule that is off says so on screen.** The card shows the default beside any rule that has
been changed, and Checks carries one note naming the rules currently disabled — a constraint
silently switched off six weeks ago is how a board gets built wrong by a person who believes
they are protected.

## Files

| file | change |
|---|---|
| `src/model/rules.js` | `RULE_DEFS`, and `netClassOf` reading patterns through it |
| `src/model/ops.js` | `setRules`, validated |
| `src/render/panels.js` | a `rules` card in `CARDS` |
| `public/app.js` | render the card from `RULE_DEFS`, and the disabled-rules note |
| `src/server/index.js` | `GET /api/rules` — the definitions, so a caller can discover them |

## Explicitly NOT changed

- `DEFAULT_RULES` and its values. What is default today stays default.
- Where each rule is enforced. `linksAreStraight` still has no checker and is still enforced in
  `addLink`, for the reason written there: a checker that can never fire reads as protection.
- The API's refusals, and the editor's warn-only split on `penWiresSignalsOnly`.

## What a green run means

`tests/model/test_rules_config.mjs` and `tests/browser/test_rules_card.mjs` report `N/N`:

- **every rule in `DEFAULT_RULES` has a `RULE_DEFS` entry and every entry names a real rule** —
  the check that keeps the two from drifting, which is the whole reason the list is data;
- `setRules` writes a rule, refuses an unknown id by name, and refuses an invalid pattern;
- a project with no `rules` key still reports the defaults;
- the Rules card shows a control per definition **without any rule being named in `app.js`**;
- switching `penWiresFreeHolesOnly` off in the card lets a pen wire land on a pin, and Checks
  says which rule is disabled;
- and switching it back on reports the wire that is now against the rules.

## What the check found that the spec had not planned for

`app.js` named a rule after all — `warnOnly: ['penWiresSignalsOnly']` at the one call site where
the editor warns instead of refusing. A literal list of which rules are advisory, free to
disagree with the definitions that already declare `warnsOnly: 'editor'`. It is now
`warnOnlyFor('editor')`, derived from `RULE_DEFS`, so the split is stated once beside the rule.

The `GET /api/rules` endpoint was dropped from scope: `RULE_DEFS` is a module both the browser
and node import directly, so an endpoint would be a second way to ask the same question.
