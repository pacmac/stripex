// The right-hand panel tabs, and the rule for when a selection brings one
// forward.
//
// This is data rather than markup because the tabs used to be hardcoded in
// index.html while their bodies were keyed by id in app.js — two lists that have
// to agree with nothing checking them. That exact shape already cost this project
// once today: reference-designator prefixes lived in a table in board.js, drifted
// from the library, and shipped a part called "X1".

export const TABS = [
  { id: 'findings', label: 'Checks' },
  { id: 'nets', label: 'Nets' },
  { id: 'runlist', label: 'Run list' },
  { id: 'inspect', label: 'Focus' },
];

export const DEFAULT_TAB = 'findings';

// Which tab a new selection should bring forward, or null for "leave it alone".
//
// Deselecting returns null on purpose: clicking empty board must not yank the
// panel away from whatever is being read, and clearing a selection is not a
// request to change the view.
//
// Callers must apply this only when the selection actually CHANGES, never on a
// redraw. A redraw happens on every edit, and a panel that jumped back to Focus
// each time you cut a track would be unusable.
export function focusTabFor(selection) {
  if (!selection) return null;
  return ['part', 'wire', 'break'].includes(selection.kind) ? 'inspect' : null;
}

export const bodyId = (tabId) => `tab-${tabId}`;
