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
