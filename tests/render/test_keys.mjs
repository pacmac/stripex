// Keyboard shortcuts for the toolbar.
// Governed by docs/specs/break-hit-targets.md (follow-on requests)

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const K = await softImport('../../src/render/keys.js', here);
const cur = await softImport('../../src/render/cursors.js', here);

const s = suite('keys');

s.check('THE DELETE KEY ARMS THE DELETE TOOL', () => {
  eq(K.toolForKey('Delete'), 'delete', 'Delete');
});

s.check('so does Backspace, which is the delete key on a lot of keyboards', () => {
  eq(K.toolForKey('Backspace'), 'delete', 'Backspace');
});

s.check('the letter shortcuts still work', () => {
  eq(K.toolForKey('v'), 'select', 'v');
  eq(K.toolForKey('p'), 'place', 'p');
  eq(K.toolForKey('b'), 'break', 'b');
  eq(K.toolForKey('w'), 'wire', 'w');
  eq(K.toolForKey('m'), 'move', 'm');
  eq(K.toolForKey('x'), 'delete', 'x');
});

s.check('shortcuts are case insensitive', () => {
  eq(K.toolForKey('V'), 'select', 'shift held');
  eq(K.toolForKey('M'), 'move', 'shift held');
});

s.check('a key that is not a shortcut maps to nothing', () => {
  eq(K.toolForKey('q'), null, 'q');
  eq(K.toolForKey('Enter'), null, 'Enter');
  eq(K.toolForKey(''), null, 'empty');
  eq(K.toolForKey(undefined), null, 'undefined');
});

s.check('EVERY TOOL IN THE TOOLBAR HAS A SHORTCUT', () => {
  // The cursor map is the list of tools the toolbar can arm, and it is already
  // asserted exhaustive there. Every one of them must be reachable by keyboard.
  const reachable = new Set(Object.values(K.TOOL_KEYS));
  for (const tool of Object.keys(cur.CURSORS)) {
    ok(reachable.has(tool), `${tool} has a key`);
  }
});

s.check('no key is bound to two different tools', () => {
  const keys = Object.keys(K.TOOL_KEYS);
  eq(new Set(keys.map((k) => k.toLowerCase())).size, keys.length, 'no duplicate keys');
});

process.exit((await s.run()) ? 0 : 1);
