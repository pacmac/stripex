// The right-hand tabs, and when selecting something brings its details forward.
// Governed by docs/specs/focus-tab.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const P = await softImport('../../src/render/panels.js', here);

const s = suite('panels');

s.check('THE DETAILS TAB IS CALLED FOCUS', () => {
  const tab = P.TABS.find((t) => t.id === 'inspect');
  ok(tab, 'there is an inspect tab');
  eq(tab.label, 'Focus', 'its label');
});

s.check('nothing is called Selected any more', () => {
  eq(P.TABS.filter((t) => t.label === 'Selected'), [], 'no tab labelled Selected');
});

s.check('the tabs are present, in order', () => {
  // NETLIST SITS BESIDE NETS on purpose: Nets is derived from the copper and
  // Netlist is the intent, and the gap between the two is the work remaining.
  eq(P.TABS.map((t) => t.id), ['findings', 'nets', 'netlist', 'runlist', 'inspect'], 'tab ids');
  eq(P.TABS.map((t) => t.label),
    ['Checks', 'Nets', 'Netlist', 'Run list', 'Focus'], 'tab labels');
});

s.check('tab ids are unique and every tab has a label', () => {
  eq(new Set(P.TABS.map((t) => t.id)).size, P.TABS.length, 'unique ids');
  for (const t of P.TABS) ok(t.label && t.label.length, `${t.id} has a label`);
});

s.check('SELECTING A PART BRINGS FOCUS FORWARD', () => {
  eq(P.focusTabFor({ kind: 'part', ref: 'R1' }), 'inspect', 'a part');
});

s.check('so does selecting a wire or a break', () => {
  eq(P.focusTabFor({ kind: 'wire', ref: 'W1' }), 'inspect', 'a wire');
  eq(P.focusTabFor({ kind: 'break', ref: '3,5' }), 'inspect', 'a break');
});

s.check('DESELECTING LEAVES THE PANEL WHERE IT IS', () => {
  // Clicking empty board must not yank the panel away from whatever is being
  // read. Clearing a selection is not a request to change the view.
  eq(P.focusTabFor(null), null, 'null selection');
  eq(P.focusTabFor(undefined), null, 'undefined selection');
});

s.check('an unrecognised selection kind does not move the panel either', () => {
  eq(P.focusTabFor({ kind: 'nonsense', ref: 'Z9' }), null, 'unknown kind');
});

s.check('every tab id a selection can name actually exists', () => {
  const ids = new Set(P.TABS.map((t) => t.id));
  for (const kind of ['part', 'wire', 'break']) {
    const target = P.focusTabFor({ kind, ref: 'X' });
    ok(ids.has(target), `${kind} -> ${target} is a real tab`);
  }
});

process.exit((await s.run()) ? 0 : 1);
