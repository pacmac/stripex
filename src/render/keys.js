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

// ------------------------------------------------- which tool comes next
//
// Both rules of this kind live here. TOOL_AFTER_ESCAPE used to sit in
// colours.js, a file about colours; two "which tool comes next" constants in two
// different files is the shape this project has already paid for twice.

// Escape means "stop what I am doing", and the armed tool is part of what you
// are doing.
export const TOOL_AFTER_ESCAPE = 'select';

// Delete fires once. It stayed armed, so deleting a resistor and then clicking
// near another part to look at it deleted that one too — and nothing on screen
// distinguishes "about to delete" from "just deleted". Every other destructive
// action here takes two decisions; this one took one and then kept taking one.
export const TOOL_AFTER_DELETE = 'select';

// The tool to switch to after a delete, or null to leave it armed.
//
// ONLY WHEN SOMETHING WAS ACTUALLY REMOVED. Clicking slightly off a pad, or on a
// cut that belongs to a component and is refused, leaves you still aiming at
// what you meant to hit; disarming there costs a click every time you miss, and
// teaches you to re-arm without looking — which is how the tool ends up armed
// when you think it is not.
export function toolAfterDelete(removed) {
  return removed ? TOOL_AFTER_DELETE : null;
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
