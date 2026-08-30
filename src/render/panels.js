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

// ---------------------------------------------------------- the left panel
//
// Four cards, each owning the settings that belong to it. Before this, the panel
// was four unrelated things stacked: the parts, the chosen part's span and
// width, the break tool's cut type, and layer visibility — with two of them
// being settings that floated free of what they configured.

export const CARDS = [
  { id: 'library', title: 'Library', icon: '▦' },
  { id: 'cutting', title: 'Cutting', icon: '✂' },
  { id: 'layers', title: 'Layers', icon: '◫' },
  { id: 'board', title: 'Board', icon: '▭' },
];

// Which card a tool opens, or null.
//
// LAYERS AND BOARD ARE NEVER OPENED BY A TOOL. They are a view concern and a
// document concern, not any tool's settings, and moving the panel on a tool
// change for something the tool does not use is exactly the disassociation this
// replaces.
const TOOL_CARDS = {
  place: 'library',
  wire: 'library',      // it picks a part from the same list
  break: 'cutting',
};

export const cardForTool = (tool) => TOOL_CARDS[tool] ?? null;

// The parameters a part actually has — nothing more, and nothing disabled.
//
// A part with none shows none. Two greyed boxes are what the old panel did, and
// they are what made span and width look like properties of the panel rather
// than of the DIP.
export function paramsFor(part) {
  const out = [];
  if (!part) return out;
  if (part.parametric === 'span') {
    out.push({
      field: 'span',
      label: part.spanLabel ?? 'span',
      min: part.minSpan ?? 1,
      value: part.defaultSpan ?? 1,
    });
  }
  if (part.defaultWidth != null) {
    out.push({
      field: 'width',
      label: part.widthLabel ?? 'width',
      min: part.minWidth ?? 2,
      value: part.defaultWidth,
    });
  }
  return out;
}

// Group a part list by category, in the order CATEGORIES declares. Empty
// categories are dropped, so a filtered library shows no empty headings.
export function groupParts(parts, categories) {
  return categories
    .map((c) => ({ id: c.id, name: c.name, parts: parts.filter((p) => p.category === c.id) }))
    .filter((g) => g.parts.length > 0);
}

// Search by name or id. Useless at fourteen parts and essential at sixty, and it
// cannot be bolted onto a list that has grown a different shape in between.
export function filterParts(parts, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return parts;
  return parts.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(q));
}

// Should this message replace the status line?
//
// The editor tested the message for TRUTHINESS, and '' — which means "clear the
// line" — is falsy. So after deselecting, the line went on naming the thing you
// had just deselected. It misled me while I was verifying something else, which
// is exactly how a stale readout costs more than it looks.
//
// The distinction is presence, not truthiness: '' clears, undefined leaves alone.
export const shouldSetStatus = (message) => message !== undefined && message !== null;

// Identifies the SHAPE of the Focus panel: which object it is describing and
// which fields that object offers. It deliberately ignores the values in those
// fields.
//
// This exists because rebuilding the panel on every edit replaced the input the
// user was typing into. The value committed correctly; the field vanished,
// taking focus and caret with it, so one change worked and the field was then
// dead — indistinguishable from "cannot be edited". Rebuild only when this key
// changes, and sync values in place otherwise.
export function inspectorKey(selection, target, part) {
  if (!selection) return null;
  if (!target) return `${selection.kind}:${selection.ref}:gone`;
  if (selection.kind === 'part') {
    // The field list is part of the shape: a resistor has no width row, an LED
    // has no span row.
    const fields = part ? editableFieldNames(part).join(',') : '';
    return `part:${selection.ref}:${target.part}:${fields}`;
  }
  return `${selection.kind}:${selection.ref}`;
}

// Kept here rather than imported from model/edit.js so that panels.js stays a
// pure view module with no model dependency; the two lists are asserted equal by
// tests/render/test_inspector_key.mjs through the behaviour they produce.
function editableFieldNames(part) {
  const fields = ['ref', 'value', 'rot', 'col', 'row'];
  if (part.parametric) fields.push('span');
  if (part.defaultWidth != null) fields.push('width');
  return fields.sort();
}
