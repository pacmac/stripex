// A net is a selection, not a second piece of state beside one.
// Governed by docs/specs/net-selection-both-ways.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const P = await softImport('../../src/render/panels.js', here);
const lib = await softImport('../../src/parts/library.js', here);

const s = suite('net-selection');

const net = (ref) => ({ kind: 'net', ref });
const part = (ref) => ({ kind: 'part', ref });

// ------------------------------------------------- the highlight is derived

s.check('A NET SELECTION IS WHAT LIGHTS THE STRIPS', () => {
  // Not a separate highlightNet kept in step by hand. Two pieces of state that
  // must agree, with nothing checking that they do, is the shape this project
  // has already paid for twice.
  eq(P.highlightFor(net('n3')), 'n3', 'a net selection');
});

s.check('nothing else lights anything', () => {
  eq(P.highlightFor(part('R1')), null, 'a part');
  eq(P.highlightFor({ kind: 'wire', ref: 'A' }), null, 'a wire');
  eq(P.highlightFor({ kind: 'break', ref: '3,5' }), null, 'a break');
  eq(P.highlightFor(null), null, 'nothing selected');
  eq(P.highlightFor(undefined), null, 'undefined');
});

s.check('an unrecognised kind lights nothing rather than throwing', () => {
  eq(P.highlightFor({ kind: 'nonsense', ref: 'x' }), null, 'unknown kind');
  eq(P.highlightFor({ ref: 'n1' }), null, 'no kind at all');
});

// ------------------------------------------------------------ the tab moves

s.check('A NET OPENS THE NETS TAB', () => {
  eq(P.focusTabFor(net('n0')), 'nets', 'a net');
});

s.check('and every other kind still opens Focus', () => {
  eq(P.focusTabFor(part('R1')), 'inspect', 'a part');
  eq(P.focusTabFor({ kind: 'wire', ref: 'A' }), 'inspect', 'a wire');
  eq(P.focusTabFor({ kind: 'break', ref: '3,5' }), 'inspect', 'a break');
});

s.check('deselecting still leaves the panel alone', () => {
  eq(P.focusTabFor(null), null, 'null');
});

s.check('the tab a net opens actually exists', () => {
  ok(P.TABS.some((t) => t.id === P.focusTabFor(net('n0'))), 'nets is a real tab');
});

// -------------------------------------------------------------- the key

s.check('A NET GETS ITS OWN PANEL KEY', () => {
  const k = P.inspectorKey(net('n0'), { id: 'n0' }, null);
  ok(k, 'a key');
  eq(typeof k, 'string', 'a string');
  ok(k !== P.inspectorKey(net('n1'), { id: 'n1' }, null), 'different nets differ');
});

s.check('A NET AND A PART OF THE SAME NAME DO NOT COLLIDE', () => {
  // A user can call a part n0. The panel must not think it is already showing it.
  const asNet = P.inspectorKey(net('n0'), { id: 'n0' }, null);
  const asPart = P.inspectorKey(part('n0'),
    { ref: 'n0', part: 'res-axial' }, lib.getPart('res-axial'));
  ok(asNet !== asPart, 'the keys differ');
});

s.check('a net key is stable while only its contents change', () => {
  eq(P.inspectorKey(net('n0'), { id: 'n0', segments: ['s:0:0'] }, null),
    P.inspectorKey(net('n0'), { id: 'n0', segments: ['s:0:0', 's:2:0'] }, null),
    'growing the net does not rebuild the panel');
});

process.exit((await s.run()) ? 0 : 1);
