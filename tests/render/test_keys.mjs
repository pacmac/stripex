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

// -------------------------------------------------- the tool after an action
// Governed by docs/specs/delete-disarms.md

s.check('A DELETE THAT REMOVED SOMETHING RETURNS TO SELECT', () => {
  // Delete stayed armed, so deleting a resistor and then clicking near another
  // part to look at it deleted that one too. Nothing on screen distinguishes
  // "about to delete" from "just deleted".
  eq(K.toolAfterDelete(true), 'select', 'something was removed');
});

s.check('and one that removed nothing leaves the tool alone', () => {
  // Clicking slightly off a pad, or on a cut that belongs to a component and is
  // refused, leaves you still aiming. Disarming there costs a click every time
  // you miss, and teaches you to re-arm without looking — which is how the tool
  // ends up armed when you think it is not.
  eq(K.toolAfterDelete(false), null, 'nothing to change');
});

s.check('BOTH "WHICH TOOL COMES NEXT" RULES LIVE IN ONE PLACE', () => {
  // TOOL_AFTER_ESCAPE was in colours.js, a file about colours. Two rules of the
  // same kind in two files is the shape this project has already paid for.
  ok(K.TOOL_AFTER_DELETE, 'the delete rule is here');
  ok(K.TOOL_AFTER_ESCAPE, 'and so is the escape rule');
});

s.check('and both name a tool the toolbar can actually arm', () => {
  // Against the tool list, not against the literal 'select' — a constant that
  // agrees with a copy of itself proves nothing.
  const tools = new Set(Object.values(K.TOOL_KEYS));
  ok(tools.has(K.TOOL_AFTER_DELETE), `${K.TOOL_AFTER_DELETE} is a real tool`);
  ok(tools.has(K.TOOL_AFTER_ESCAPE), `${K.TOOL_AFTER_ESCAPE} is a real tool`);
});

// ------------------------------------------------- undo and redo on the keyboard
// Governed by docs/specs/undo-shortcut.md

const ev = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

s.check('CTRL+Z IS UNDO AND CTRL+SHIFT+Z IS REDO', () => {
  eq(K.historyActionForKey(ev('z', { ctrlKey: true })), 'undo', 'ctrl+z');
  eq(K.historyActionForKey(ev('z', { ctrlKey: true, shiftKey: true })), 'redo', 'ctrl+shift+z');
});

s.check('Cmd works too, and the case of the letter does not matter', () => {
  // Shift makes the browser report 'Z', so reading the key literally would have
  // made redo unreachable on every keyboard.
  eq(K.historyActionForKey(ev('z', { metaKey: true })), 'undo', 'cmd+z');
  eq(K.historyActionForKey(ev('Z', { ctrlKey: true, shiftKey: true })), 'redo', 'capital Z');
  eq(K.historyActionForKey(ev('Z', { metaKey: true, shiftKey: true })), 'redo', 'cmd+shift+Z');
});

s.check('and nothing else is', () => {
  eq(K.historyActionForKey(ev('z')), null, 'a bare z is the letter z');
  eq(K.historyActionForKey(ev('y', { ctrlKey: true })), null, 'ctrl+y is not bound');
  eq(K.historyActionForKey(ev('a', { ctrlKey: true })), null, 'ctrl+a');
  eq(K.historyActionForKey(null), null, 'nothing at all');
});

// -------------------------------------------- who may swallow the shortcut

const el = (tag, type) => ({
  tagName: tag.toUpperCase(),
  type,
  isContentEditable: false,
});

s.check('A DROPDOWN DOES NOT OWN CTRL+Z', () => {
  // Measured: with the View select focused, Ctrl+Z did nothing at all. A field
  // may swallow the shortcut when it has an undo of its own to offer instead.
  // A select has none, so the keystroke was simply lost — and changing the view
  // and then wanting to undo something is an ordinary thing to do.
  eq(K.ownsUndo(el('select')), false, 'a select');
});

s.check('nor does anything else without text to undo', () => {
  // All of these exist in this editor: the Layers checkboxes, the net colour
  // swatches, the colour input in Focus.
  eq(K.ownsUndo(el('input', 'checkbox')), false, 'a checkbox');
  eq(K.ownsUndo(el('input', 'radio')), false, 'a radio');
  eq(K.ownsUndo(el('input', 'color')), false, 'a colour input');
  eq(K.ownsUndo(el('input', 'range')), false, 'a slider');
  eq(K.ownsUndo(el('input', 'file')), false, 'a file input');
  eq(K.ownsUndo(el('button')), false, 'a button');
  eq(K.ownsUndo(el('div')), false, 'a plain element');
  eq(K.ownsUndo(null), false, 'nothing');
});

s.check('BUT A TEXT FIELD DOES, AND KEEPS ITS OWN UNDO', () => {
  // Measured: typing GND into a net-name field and pressing Ctrl+Z cleared the
  // FIELD and left the board alone. That is right and must stay right.
  eq(K.ownsUndo(el('input', 'text')), true, 'a text input');
  eq(K.ownsUndo(el('input')), true, 'an input with no type is a text input');
  eq(K.ownsUndo(el('input', 'number')), true, 'a number input — span and width are typed into');
  eq(K.ownsUndo(el('input', 'search')), true, 'search');
  eq(K.ownsUndo(el('textarea')), true, 'a textarea');
  eq(K.ownsUndo({ tagName: 'DIV', isContentEditable: true }), true, 'contenteditable');
});

process.exit((await s.run()) ? 0 : 1);
