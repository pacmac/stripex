// Keyboard shortcuts for the toolbar.
//
// A map rather than a switch in the editor, so node can check that every tool
// the toolbar can arm is reachable from the keyboard — the same reason the
// cursor map lives in cursors.js, and it caught the move tool the day it was
// added.

export const TOOL_KEYS = {
  v: 'select',
  p: 'place',
  b: 'break',
  w: 'wire',
  m: 'move',
  x: 'delete',
  // The obvious key for it. Backspace as well, because on a lot of keyboards
  // that is the key labelled Delete.
  Delete: 'delete',
  Backspace: 'delete',
};

export function toolForKey(key) {
  if (!key) return null;
  return TOOL_KEYS[key] ?? TOOL_KEYS[String(key).toLowerCase()] ?? null;
}

// ------------------------------------------------------------ undo and redo

// Ctrl+Z, and Ctrl+Shift+Z for redo. Cmd is accepted alongside Ctrl because it
// costs nothing and is what the same keyboard sends on a Mac.
//
// The letter is lowercased before comparing: Shift makes the browser report
// 'Z', so reading `key` literally would leave redo unreachable on every
// keyboard in the world.
export function historyActionForKey(evt) {
  if (!evt || !(evt.ctrlKey || evt.metaKey)) return null;
  if (String(evt.key ?? '').toLowerCase() !== 'z') return null;
  return evt.shiftKey ? 'redo' : 'undo';
}

// Input types that hold editable TEXT, and therefore have an undo of their own.
// `number` belongs here: the span and width fields are numbers you type into.
const TEXTY = new Set([
  '', 'text', 'search', 'url', 'tel', 'email', 'password', 'number',
]);

// May this element swallow Ctrl+Z?
//
// Only if it has an undo of its own to offer instead — while you are typing,
// its undo is the one you want. A `<select>` has none: it took the keystroke
// and gave nothing back, so with the View dropdown focused Ctrl+Z did nothing
// at all. Same for the Layers checkboxes, the net colour swatches and the
// colour input in Focus.
//
// The old guard was `matches('input, select, textarea')`, which asks what an
// element IS. The question is what it can DO.
export function ownsUndo(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName ?? '').toLowerCase();
  if (tag === 'textarea') return true;
  if (tag !== 'input') return false;
  return TEXTY.has(String(target.type ?? '').toLowerCase());
}
