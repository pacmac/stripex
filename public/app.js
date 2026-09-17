// The editor: state, tools, undo, event delegation.
//
// It owns NO drawing. Every pixel comes from renderBoard() in src/render/svg.js,
// which node also imports, so what the tests check and what the browser shows
// cannot drift apart. Hit-testing reads data-* attributes off event.target
// rather than recomputing layout — one description of where things are.

import { renderBoard, DEFAULT_LAYERS, drawingExtentMm } from '/src/render/svg.js';
import { printLayout, viewBoxSize, cutRows, wireRows } from '/src/render/print.js';
import { PITCH_MM } from '/src/model/geometry.js';
import { findingsFor, netsFor, runList, bomFor } from '/src/model/views.js';
import { makeProject, validateProject, nextWireRef, nextPartRef } from '/src/model/board.js';
import { rotatePlacement, resolvePins } from '/src/model/rotate.js';
import { requiredBreaks, ownerOf, effectiveBreaks } from '/src/model/breaks.js';
import { cursorFor } from '/src/render/cursors.js';
import {
  TABS, DEFAULT_TAB, focusTabFor, bodyId, inspectorKey, shouldSetStatus,
  CARDS, cardForTool, paramsFor, groupParts, filterParts, highlightFor,
} from '/src/render/panels.js';
import {
  toolForKey, historyActionForKey, ownsUndo, toolAfterDelete, TOOL_AFTER_ESCAPE,
} from '/src/render/keys.js';
import { loadProject } from '/src/model/repair.js';
import { pushSnapshot, readHistory, describe } from '/src/model/history.js';
import { makeUndo } from '/src/model/undo.js';
import {
  netLabelsByNet, netLabelsAllByNet, netLabelProblems, setNetLabel,
} from '/src/model/nets.js';
import { segments } from '/src/net/segments.js';

// A banner is how the user is told something happened to their board. A console
// warning is not telling anyone.
function banner(text, kind = 'warn') {
  const el = document.createElement('p');
  el.className = `banner banner-${kind}`;
  el.textContent = text;
  document.body.insertBefore(el, document.body.firstChild);
}
import { applyPlacementEdit, applyWireEdit, editableFields } from '/src/model/edit.js';
import { pinLocation } from '/src/model/move.js';
// EVERY EDIT GOES THROUGH HERE. The editor used to push into state.project
// directly, so a wire the API refused was accepted by clicking — one board with
// two sets of rules, and the looser one was the one a person used.
import * as ops from '/src/model/ops.js';
import { compareToNetlist, netlistFindings } from '/src/model/netlist.js';
import {
  checkRules, disabledRuleNotes, rulesFor, ruleValue, warnOnlyFor,
  RULE_DEFS, DEFAULT_RULES,
} from '/src/model/rules.js';
import {
  wireColour, silkOf, linkColour, wireLengthHoles,
  COLOUR_CODE, PALETTE_16,
} from '/src/render/colours.js';
import {
  deviceList, getDevice, placementFor, installDevices,
} from '/src/parts/devices.js';

// The theme's silk colour, for seeding the colour input when a part has none of
// its own. A colour input cannot show "unset", so it shows what is being used.
const THEME_SILK = { light: '#26303d', dark: '#e6ded0' };

// Sixteen swatches and a Default. The native colour input opens an operating
// system dialog with a spectrum, an eyedropper and a hex field, for a choice
// between a handful of sane values on a board.
//
// Default matters more than the sixteen: without a way to clear an override
// there is no route back to "whatever the length says".
function swatches(field, current, effective, label) {
  const cells = PALETTE_16.map((c) => `<button class="sw${
    current === c.hex ? ' is-on' : ''}" data-swatch="${field}" data-hex="${c.hex}"
    style="background:${c.hex}" title="${c.name}"></button>`).join('');
  return `<div class="field"><span>${label}</span>
      <span class="sw-now" style="background:${effective}" title="in use"></span></div>
    <div class="swatches" data-for="${field}">${cells}
      <button class="sw sw-clear${current ? '' : ' is-on'}" data-swatch="${field}"
        data-hex="" title="Default">&times;</button></div>`;
}
import {
  partList, getPart, defaultRotOf, placesWith, CATEGORIES, pinLabel, sideOf, pinsOf,
} from '/src/parts/library.js';

const $ = (sel) => document.querySelector(sel);

// THE BROWSER KEEPS NO COPY OF THE BOARD.
//
// There was a `stripex.project` here holding a whole board, and a
// `stripex.dirty` flag beside it, and that copy was treated as authoritative on
// load. All three of Peter's name reversions were the same shape: a stale copy
// written back over the server. Once because opening a board saved it, once
// because that was only half fixed, and once because a branch adopted the
// server's fresh version token and then wrote old content, so the guard that
// existed to stop exactly this could not fire.
//
// What it bought was the work done in the 400 ms between an edit and its save.
// A cache that is only ever read at boot is not a cache; it is a second source
// of truth, and this one lost three arguments with the first.
//
// Peter, 2026-08-31: "STILL BROKEN: the draft cache itself - fix it".
//
// Which board this tab is looking at stays, because that is the browser's own
// business and not the server's — a bookmark, not a copy.
const OPEN_KEY = 'stripex.openBoard';

// Repairs found on the last load, shown as a banner. Not a console warning:
// load() used to return null on any problem, hand the user an empty board, and
// whisper about it to a console nobody had open.
//
// DECLARED HERE, above `state`. `state` calls load() during its own
// initialisation, so a `let` further down the file is in its temporal dead zone
// and the whole editor dies with "Cannot access 'loadRepairs' before
// initialization" — a blank page, which is the exact failure this work exists
// to stop. tests/render/test_boot.mjs holds that line down.
let loadRepairs = [];
const LAYER_KEY = 'stripex.layers';

// HOW THE LIBRARY IS SHOWN — list or tiles, and which groups are folded. A view
// preference, the same kind of thing as the layers: it belongs to whoever is
// looking, not to the board, and nothing about a board is ever kept here. The
// page is right without it, so a blocked or cleared store costs only the
// preference.
const LIB_KEY = 'stripex.library';

function loadLibraryView() {
  try {
    const raw = JSON.parse(localStorage.getItem(LIB_KEY) ?? 'null');
    return {
      libView: raw?.view === 'tiles' ? 'tiles' : 'list',
      libCollapsed: new Set(Array.isArray(raw?.collapsed) ? raw.collapsed : []),
    };
  } catch {
    return { libView: 'list', libCollapsed: new Set() };
  }
}

function saveLibraryView() {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify({
      view: state.libView, collapsed: [...state.libCollapsed],
    }));
  } catch { /* a preference, not a record */ }
}

// Order and wording of the layer list. The swatch is the colour that layer
// actually paints, so the list reads as the drawing rather than as a glossary.
const LAYER_ROWS = [
  // First, because it is drawn last. The list reads top-of-stack downwards, and
  // a list that disagrees with the drawing order is a second description of the
  // same fact — the shape this project has already paid for twice.
  ['netNames', 'Net names', '#9c6428'],
  // Off by default — the only one that is. It draws an annotation you ask for
  // rather than something the board has, and a board covered in pin names is
  // unreadable while placing and essential while wiring.
  ['pinNames', 'Pin names', '#3d4450'],
  ['components', 'Components', '#3d4450'],
  ['links', 'Wire links', '#8e9099'],
  ['wires', 'Pen wires', '#1f6feb'],
  ['breaks', 'Track breaks', '#8a7a5c'],
  ['copper', 'Copper strips', '#b87333'],
  ['holes', 'Holes', '#3a3226'],
  // "Refs and values" is a separate switch from Net names above: that one names
  // the parts you placed, this one names copper you did not. Turning off R1 and
  // 10k is not asking for GND to go with them.
  ['labels', 'Refs and values', '#241f18'],
  // Outside the board: rows A, B … and columns 1, 2 … for finding a hole.
  ['edgeLabels', 'Row and column labels', '#6d6555'],
  ['drc', 'Check markers', '#d1242f'],
];

const state = {
  // An empty board until the server says otherwise. Nothing here pretends to be
  // a document: what used to sit in this slot was the cached copy, which is how
  // a stale board got on screen and then written back over the real one.
  project: load() ?? makeProject({ cols: 25, rows: 20 }),
  tool: 'select',
  part: 'res-axial',
  // The armed DEVICE, or null for a generic part. It arms its base part
  // alongside itself, so everything that asks "what is armed" still works.
  device: null,
  // The board on the SERVER: which one, and the version it was read at. The
  // version is what stops an autosave erasing somebody else's edit to the file.
  slug: null,
  version: null,
  boards: [],
  conflict: null,
  serverError: null,
  // False until connectBoards has decided which board is open and whether this
  // browser holds work the server has not. Nothing may save before then.
  ready: false,
  span: 4,
  width: 3,
  cut: 'gap',
  rot: 0,
  view: 'top',
  theme: 'light',
  selection: null,
  // No `highlightNet`. A lit net IS a selection — { kind: 'net', ref } — and the
  // highlight is derived from it at the point of use. Two pieces of state that
  // must agree, with nothing checking that they do, is the shape that has
  // already cost this project twice.
  wireStart: null,
  moveAnchor: null,
  drag: null,
  // Which left-hand card is open. Arming a tool opens the card that holds its
  // settings; a card opened by hand stays open until a tool that owns one is
  // armed. Nothing ever disappears, so the panel's shape is learnable.
  openCard: 'library',
  search: '',
  ...loadLibraryView(),
  layers: loadLayers(),
  // The stacks live in src/model/undo.js — see `history` below. They were two
  // arrays here, and the bug they held was unreachable by any check because
  // app.js exports nothing and the node harness has no DOM.
};

// Layer visibility is a view preference, not part of the design, so it lives
// beside the project rather than inside it — two people opening the same board
// should not inherit each other's hidden layers.
function loadLayers() {
  try {
    const raw = localStorage.getItem(LAYER_KEY);
    return raw ? { ...DEFAULT_LAYERS, ...JSON.parse(raw) } : { ...DEFAULT_LAYERS };
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

// ------------------------------------------------------------------ persistence

// WHAT TO DRAW BEFORE THE SERVER HAS ANSWERED: an empty board of the default
// size, and nothing pretending to be a document. It used to be the cached copy,
// which is how a stale board got on screen and then written back.
function load() {
  return null;
}

// Returns whether it actually wrote. The old version swallowed a quota error in
// an empty catch, so once storage filled every later edit was silently not
// saved and you found out on reload.
// An edit happened: snapshot it for Restore, and send it to the server, which is
// the only place the board lives.
//
// THE SNAPSHOT HISTORY IS NOT A CACHE. It is an archive, read only when Restore
// is pressed, never treated as the current board and never written back on its
// own — which is why it stays while the draft copy goes.
function persist() {
  try { pushSnapshot(localStorage, state.project); } catch { /* history is expendable */ }
  scheduleSave();
  return true;
}

// The localStorage copy, and nothing else. Its job is now narrow and honest: it
// draws the board while the server is unreachable. It is a cache, not a second
// source of truth — which is what it had quietly become.
// Nothing to do any more: there is no draft to write. Kept as a no-op for one
// release rather than chased through every call site in the same change that
// removes the cache, so the diff says one thing.
function persistDraftOnly() {}

// ------------------------------------------------------------- the server

const api = async (url, opts) => {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  let body = null;
  try { body = await res.json(); } catch { /* a body is optional */ }
  return { ok: res.ok, status: res.status, body };
};

async function refreshBoards() {
  const { ok, body } = await api('/api/boards');
  if (ok) state.boards = body.boards ?? [];
  return state.boards;
}

// Debounced, because a commit happens on every click and a board is small but a
// write is a write.
let saveTimer = null;
let saving = false;
// An edit that arrived before the board was open. Flushed once, by
// connectBoards, and only if it really happened — see the comment there.
let savePending = false;
function scheduleSave() {
  // NOTHING SAVES UNTIL THE DRAFT QUESTION IS SETTLED. Boot draws, then asks the
  // server what it has and whether this browser holds something different. A
  // save firing inside that window pushed the draft up before the comparison
  // read it, so the two matched, so the draft was treated as "same as the
  // server" and replaced — the same data loss by a different route, and
  // intermittent, which is worse. Measured as 1 of 3 runs passing.
  if (!state.slug) return;
  if (!state.ready) { savePending = true; return; }
  showSaveState('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToServer, 400);
}

// SAY THAT IT SAVED. Peter read the Save button — which downloads a file — as
// the only way work reached the server, and concluded nothing did. Continuous
// saving that shows no sign of itself is indistinguishable from no saving.
const SAVE_WORDS = {
  saving: ['· saving', 'saving to the server'],
  saved: ['✓ saved', 'saved on the server'],
  failed: ['! not saved', 'NOT saved on the server — see the banner'],
};
function showSaveState(kind) {
  const el = $('#saveState');
  if (!el) return;
  const [text, title] = SAVE_WORDS[kind] ?? ['', ''];
  el.textContent = text;
  el.title = title;
  el.dataset.state = kind;
}

async function saveToServer() {
  if (!state.slug || saving) return;
  saving = true;
  try {
    const { ok, status, body } = await api(`/api/boards/${state.slug}`, {
      method: 'PUT',
      body: JSON.stringify({ project: state.project, version: state.version }),
    });
    if (ok) {
      state.version = body.version;
      state.serverError = null;
      showSaveState('saved');
      return;
    }
    if (status === 409) {
      // SOMEBODY ELSE CHANGED IT. Not overwritten and not silently reloaded —
      // the work on screen is as real as the work on disk, so it is a question.
      state.conflict = body.project ?? null;
      banner(`This board changed on the server since you opened it. Your work is `
        + 'NOT saved. Open the Board card to take theirs, or Save to keep a copy of yours.',
      'error');
      return;
    }
    showSaveState('failed');
    state.serverError = body?.error ?? `save failed (${status})`;
    banner(`NOT SAVED to the server — ${state.serverError}. Your work is still in this `
      + 'browser; use Save to download it.', 'error');
  } catch (e) {
    state.serverError = e.message;
    banner(`The server is not answering (${e.message}). Still drawing, still kept in this `
      + 'browser — nothing is lost, but nothing is being shared either.', 'warn');
  } finally {
    saving = false;
  }
}

// Open a board: the server's copy, and only ever the server's copy.
//
// There was a `keepDraft` branch here that installed the browser's own project
// instead, on the grounds that it might hold unsaved work. It reverted Peter's
// board name three times, because a draft's name is always stale and the branch
// adopted the server's version token before writing old content — so the guard
// built to stop exactly that could not fire.
//
// With no cache there is no second copy to prefer, no question to ask, and
// nothing to reconcile. An edit is 400 ms from the server; that is the whole
// window this used to protect.
async function openBoard(slug) {
  const { ok, body } = await api(`/api/boards/${slug}`);
  if (!ok) return say(body?.error ?? 'could not open that board');

  const { project, repairs } = loadProject(JSON.stringify(body.project));
  if (!project) return say('that board could not be read');
  loadRepairs = repairs;
  state.project = project;
  state.slug = slug;
  state.version = body.version;
  state.conflict = null;
  state.selection = null;
  history.reset(state.project);
  localStorage.setItem(OPEN_KEY, slug);
  // OPENING A BOARD IS NOT AN EDIT, and this line is where that kept going
  // wrong. persist() ends in scheduleSave(): before the editor is ready that
  // sets savePending, and the boot flush in connectBoards then sends it — so a
  // browser that merely LOOKED at a board wrote its own copy back over whatever
  // the server had.
  //
  // Peter reported it twice. The first fix removed the unconditional
  // scheduleSave() from connectBoards and left this one, which was enough to put
  // the symptom back: his Yagi V5 Control Board lost the name he had given it to
  // a screenshot run, because the browser had fetched the board before the
  // rename and wrote its stale copy afterwards.
  //
  // persistDraftOnly writes the localStorage cache and nothing else, which is
  // exactly what looking at a board should cost.
  persistDraftOnly();
  await refreshBoards();
  paintCards();
  draw(`opened ${project.name ?? slug}`);
  if (repairs.length) {
    banner(`${repairs.length} thing${repairs.length === 1 ? '' : 's'} in that board `
      + `could not be read and ${repairs.length === 1 ? 'was' : 'were'} dropped: `
      + repairs.map((r) => r.message).join('; '), 'warn');
  }
}

async function newBoard(name, project = null) {
  const { ok, body } = await api('/api/boards', {
    method: 'POST',
    body: JSON.stringify({
      name,
      project: project ?? undefined,
      cols: state.project?.board?.cols ?? 25,
      rows: state.project?.board?.rows ?? 20,
    }),
  });
  if (!ok) return say(body?.error ?? 'could not create that board');
  await refreshBoards();
  return openBoard(body.slug);
}

async function renameBoard(name) {
  const wanted = String(name ?? '').trim();
  if (!wanted || wanted === state.project.name) return;
  if (!state.slug) {
    // Not on the server yet: naming it is what puts it there.
    return newBoard(wanted, state.project);
  }
  const { ok, body } = await api(`/api/boards/${state.slug}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name: wanted }),
  });
  if (!ok) return say(body?.error ?? 'could not rename that board');
  state.slug = body.slug;
  state.version = body.version;
  state.project = { ...state.project, name: wanted };
  // AND WRITE IT DOWN. This set the name in memory and left the cached copy
  // holding the old one, so the browser went stale the instant a board was
  // renamed — and every later save carried the name back with it.
  persistDraftOnly();
  localStorage.setItem(OPEN_KEY, body.slug);
  await refreshBoards();
  paintCards();
  return draw(`renamed to ${wanted}`);
}

// ------------------------------------------------------------------------ undo
//
// Snapshots, not command/inverse pairs. The project is small and JSON-cloneable,
// so a snapshot stack is correct by construction; an inverse-command stack would
// need every tool to get its own undo right, and one of them eventually would not.

// THE SNAPSHOT IS OF THE STATE BEFORE THE CHANGE. Every tool here mutates
// state.project in place and then calls commit, so pushing state.project at this
// point stored the state AFTER the change and undo reinstalled the state you
// were already in: the first press did nothing, every later press was a step
// behind, and the board you started a session with was unreachable.
//
// src/model/undo.js keeps the baseline — the project as it stood after the last
// commit — so no call site has to remember its own "before". Fifteen of them do,
// and one would eventually forget.
const history = makeUndo(state.project);

function commit(label) {
  history.commit(state.project);
  persist();
  draw(label);
}

function undo() {
  const prev = history.undo(state.project);
  if (!prev) return say('nothing to undo');
  state.project = prev;
  state.selection = null;
  persist();
  draw('undone');
}

function redo() {
  const next = history.redo(state.project);
  if (!next) return say('nothing to redo');
  state.project = next;
  state.selection = null;
  persist();
  draw('redone');
}

// ----------------------------------------------------------------------- draw

let lastFindings = [];

function draw(message) {
  const p = state.project;
  // THE DESIGN RULES REPORT ALONGSIDE THE DRC. checkRules produces findings in
  // the DRC's own shape, so the Checks tab and the board markers show them
  // without learning a second format. This is where a pen wire on power — which
  // the editor allows and the API refuses — becomes visible instead of silent.
  lastFindings = [
    ...findingsFor(p), ...checkRules(p), ...disabledRuleNotes(p),
    // Only when the board carries one. A netlist is an optional statement of
    // intent, and a board without one is not thereby incomplete.
    ...(p.netlist ? netlistFindings(p, p.netlist) : []),
  ];

  $('#boardWrap').innerHTML = renderBoard(p, {
    view: state.view,
    theme: state.theme,
    highlightNet: highlightFor(state.selection),
    findings: lastFindings,
    selection: state.selection,
    layers: state.layers,
    moveAnchor: state.moveAnchor,
    pendingWire: state.wireStart,
  });

  paintFindings(lastFindings);
  paintNets();
  paintNetlist();
  paintRunList();
  paintInspector();
  paintLayers();
  markSelectedRows();
  focusOnSelectionChange();
  // A board that changes under the Print view — a save from elsewhere, an undo
  // — changes its preview too, or the page would print something stale.
  if (state.printing) paintPrintView();
  if (shouldSetStatus(message)) say(message);
}

function buildTabs() {
  $('#tabs').innerHTML = TABS.map((t) => `
    <button class="tab${t.id === DEFAULT_TAB ? ' is-on' : ''}" data-tab="${t.id}">${t.label}</button>`
  ).join('');
  $('#tabBodies').innerHTML = TABS.map((t) => `
    <div class="tab-body" id="${bodyId(t.id)}"${t.id === DEFAULT_TAB ? '' : ' hidden'}></div>`
  ).join('');
}

function showTab(id) {
  for (const t of document.querySelectorAll('.tab')) {
    t.classList.toggle('is-on', t.dataset.tab === id);
  }
  for (const body of document.querySelectorAll('.tab-body')) {
    body.hidden = body.id !== bodyId(id);
  }
}

// Bring the Focus tab forward when a NEW selection arrives — never on a redraw.
// A redraw happens on every edit, and a panel that jumped back to Focus each
// time you cut a track would be unusable. Deselecting deliberately does nothing:
// clicking empty board must not yank the panel away from what you were reading.
let lastSelectionKey = null;

function focusOnSelectionChange() {
  const sel = state.selection;
  const key = sel ? `${sel.kind}:${sel.ref}` : null;
  if (key === lastSelectionKey) return;
  lastSelectionKey = key;
  const target = focusTabFor(sel);
  if (target) showTab(target);
  scrollSelectionIntoPanel();
}

// Bring the marked row to the TOP of the panel.
//
// Marking it was not enough: on Peter's board the Nets tab is 27 rows and the
// panel shows about eight, so the row it marked measured 2076px below the top of
// the panel — the feature worked and looked like it did not.
//
// The top rather than merely into view. `block: 'nearest'` leaves a row that is
// already visible where it is; a fixed landing place means the eye knows where
// to look without hunting, and the rows below it are that net's neighbours.
//
// Only on a CHANGE of selection — the caller is the one place that knows that.
// Scrolling the list under the pointer while somebody is clicking down it would
// be its own defect.
function scrollSelectionIntoPanel() {
  const row = document.querySelector('.tab-body .row.is-net-on, .tab-body .row[data-selected="true"]');
  if (!row) return;
  const panel = row.closest('.panel');
  if (!panel) return;
  panel.scrollTop += row.getBoundingClientRect().top - panel.getBoundingClientRect().top;
}

// -------------------------------------------------------------------- print
//
// Peter: "rename Underside -> "Bot", add another button print ... the layer
// selection and print settings should persist so that each time I print I wont
// have to re-select everything. this panel should have a print button, probably
// top right". See docs/specs/print-view.md.
//
// Print is a VIEW. Its choices — the page, which layers, which tables — are a
// preference of whoever is printing, kept like the layers are, and no board
// data goes near the browser store. The first time, the print layers start from
// the layers on screen; after that they are their own.
const PRINT_KEY = 'stripex.print';
const PRINT_LAYERS = LAYER_ROWS.filter(([k]) => k !== 'drc');

const printPrefs = (() => {
  const base = {
    colour: 'colour',
    sides: 'both',
    size: 'actual',
    layers: Object.fromEntries(PRINT_LAYERS.map(([k]) => [k, state.layers?.[k] !== false])),
    tables: { bom: false, cuts: false, wires: false },
  };
  try {
    const raw = JSON.parse(localStorage.getItem(PRINT_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      return {
        ...base, ...raw,
        layers: { ...base.layers, ...(raw.layers ?? {}) },
        tables: { ...base.tables, ...(raw.tables ?? {}) },
      };
    }
  } catch { /* a preference, not a record */ }
  return base;
})();

function savePrintPrefs() {
  try { localStorage.setItem(PRINT_KEY, JSON.stringify(printPrefs)); } catch { /* a preference */ }
}

// The drawing for paper: the print layers, never the check markers, never a
// selection or a lit net — those belong to editing, not to a build sheet.
const printSvg = (view, theme) => renderBoard(state.project, {
  view, theme, layers: { ...DEFAULT_LAYERS, ...printPrefs.layers, drc: false },
});

const printLayoutFor = (theme) => printLayout({
  drawing: viewBoxSize(printSvg('top', theme)), sides: printPrefs.sides, size: printPrefs.size,
});

// ONE SHEET, built here and used twice: once into the preview, once onto paper.
// A preview built separately would be a second thing that can disagree.
function printSheetHtml() {
  const mono = printPrefs.colour === 'mono';
  const theme = mono ? 'mono' : 'light';
  const lay = printLayoutFor(theme);
  const caption = {
    top: 'Top — the component side',
    underside: 'Bot — the copper side, mirrored',
  };
  const scaleText = printPrefs.size === 'actual'
    ? 'actual size — one hole is 2.54 mm'
    : `scaled to ${Math.round(lay.scale * 100)}%`;
  const table = (id, title, head, rows) => `<section class="printtable"><h3>${title}</h3>${rows.length
    ? `<table data-table="${id}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`
      + `<tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '<p class="printnone">None on this board.</p>'}</section>`;

  const html = `<header class="printhead"><b>${escapeHtml(state.project.name || 'board')}</b>`
    + `<span>${new Date().toISOString().slice(0, 10)}</span><span>${scaleText}</span></header>`
    + lay.views.map((v) => `<figure class="printview"><figcaption>${caption[v.view]}</figcaption>${
      // Millimetres on the element: the drawing's own units, so actual size
      // really is one hole to 2.54 mm on the paper.
      printSvg(v.view, theme).replace('width="100%" height="100%"',
        `width="${v.widthMm}mm" height="${v.heightMm}mm"`)}</figure>`).join('')
    + (printPrefs.tables.bom ? table('bom', 'Bill of materials', ['Qty', 'Refs', 'Value', 'Part'],
      bomFor(state.project).map((r) => [String(r.qty), r.refs.join(', '), r.value, r.part])) : '')
    + (printPrefs.tables.cuts ? table('cuts', 'Cut list', ['Where', 'Cut'],
      cutRows(state.project).map((c) => [c.where, c.kind])) : '')
    + (printPrefs.tables.wires ? table('wires', 'Wire runs', ['Ref', 'From', 'To'],
      wireRows(state.project).map((w) => [w.ref, w.from, w.to])) : '');
  return { html, mono, lay };
}

function paintPrintView() {
  const panel = $('#printView');
  if (!panel || panel.hidden) return;
  for (const key of ['colour', 'sides', 'size']) {
    const attr = `print${key[0].toUpperCase()}${key.slice(1)}`;
    for (const b of panel.querySelectorAll(`[data-print-${key}]`)) {
      const on = b.dataset[attr] === printPrefs[key];
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  const layers = $('#pvLayers');
  if (!layers.children.length) {
    layers.innerHTML = PRINT_LAYERS.map(([k, label]) => `<label>
      <input type="checkbox" data-print-layer="${k}"> ${escapeHtml(label)}</label>`).join('');
  }
  for (const box of panel.querySelectorAll('[data-print-layer]')) box.checked = printPrefs.layers[box.dataset.printLayer] !== false;
  for (const box of panel.querySelectorAll('[data-print-table]')) box.checked = Boolean(printPrefs.tables[box.dataset.printTable]);

  const { html, mono, lay } = printSheetHtml();
  $('#pvFit').textContent = lay.message;
  $('#pvFit').classList.toggle('is-warn', !lay.fits);
  const page = $('#pvPreview .pv-page');
  page.classList.toggle('is-mono', mono);
  $('#pvPreview .pv-sheet').innerHTML = html;
  // Fit the A4 page to the pane's width. zoom rather than a transform, so the
  // pane scrolls over the real height of a sheet that runs onto a second page.
  const pane = $('#pvPreview');
  const pageMm = 210;
  const pxPerMm = 96 / 25.4;
  page.style.zoom = String(Math.min(1.4, Math.max(0.3, (pane.clientWidth - 40) / (pageMm * pxPerMm))));
}

function showPrintView(on) {
  state.printing = on;
  $('#printView').hidden = !on;
  $('#stage').classList.toggle('is-printing', on);
  if (on) paintPrintView();
}

// A layer switched on or off. Attached ONCE to the Layers card body, in
// buildCards — see the note in paintLayers for what repeating it cost.
function onLayerChange(e) {
  const key = e.target.dataset.layer;
  if (!key) return;
  state.layers[key] = e.target.checked;
  try { localStorage.setItem(LAYER_KEY, JSON.stringify(state.layers)); } catch { /* full */ }
  const off = LAYER_ROWS.filter(([k]) => !state.layers[k]).map(([, l]) => l.toLowerCase());
  draw(off.length ? `hidden: ${off.join(', ')}` : 'all layers shown');
}

function paintLayers() {
  const body = $('[data-cardbody="layers"]');
  if (!body) return;
  const hidden = LAYER_ROWS.filter(([k]) => !state.layers[k]).length;
  body.innerHTML = `<div class="layers">${LAYER_ROWS.map(([key, label, colour]) => `
    <label class="${state.layers[key] ? '' : 'is-off'}">
      <input type="checkbox" data-layer="${key}" ${state.layers[key] ? 'checked' : ''}>
      <span class="swatch" style="background:${colour}"></span>
      <span>${label}</span>
    </label>`).join('')}</div>
    ${hidden ? '<button id="layersAll" class="linky">show every layer</button>' : ''}`;
  // NO LISTENER ON `body` HERE. The body survives this repaint — only its
  // children are replaced — and draw() repaints this card on every change, so a
  // listener added here was added again every time: one toggle ran one full
  // redraw per edit so far, 768 of them after eight toggles, which is the hang
  // Peter hit. It is attached once, in buildCards (onLayerChange). The button
  // below is new each time, so its listener is not.
  $('#layersAll')?.addEventListener('click', () => {
    state.layers = { ...DEFAULT_LAYERS };
    try { localStorage.setItem(LAYER_KEY, JSON.stringify(state.layers)); } catch { /* full */ }
    draw('all layers shown');
  });
}

// The selection has to be visible in the panels too, not only on the board —
// otherwise a selected wire is findable in the drawing but not in the run list
// you are building the board from.
function markSelectedRows() {
  for (const row of document.querySelectorAll('.tab-body .row')) {
    row.removeAttribute('data-selected');
  }
  const sel = state.selection;
  if (!sel) return;
  for (const row of document.querySelectorAll(
    `[data-wire="${CSS.escape(sel.ref)}"], .tab-body .row`,
  )) {
    const ref = row.dataset.wire ?? row.querySelector('.ref')?.textContent?.trim();
    if (ref === sel.ref) row.setAttribute('data-selected', 'true');
  }
}

function say(msg) {
  const errors = lastFindings.filter((f) => f.severity === 'error').length;
  $('#status').textContent = errors
    ? `${msg ?? ''}${msg ? ' — ' : ''}${errors} error${errors === 1 ? '' : 's'}, see Checks`
    : (msg ?? '');
}

// --------------------------------------------------------------------- panels

function paintFindings(findings) {
  const el = $('#tab-findings');
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  const count = (sev) => findings.filter((f) => f.severity === sev).length;

  const tally = `<div class="tally">
    <span><b class="error">${count('error')}</b> errors</span>
    <span><b class="warning">${count('warning')}</b> warnings</span>
    <span><b class="ok">${count('info')}</b> notes</span></div>`;

  if (!sorted.length) {
    el.innerHTML = `${tally}<p class="empty">Nothing to report.</p>`;
    return;
  }

  const row = (f) => `
    <div class="row ${f.severity}" data-code="${f.code}">
      <span class="ref">${f.refs?.[0] ?? '·'}</span>
      <span class="msg">${escapeHtml(f.message)}</span>
    </div>`;

  // Some findings arrive in floods. A fresh 20-row board has twenty unused
  // strips; a correctly cut DIP-14 has fourteen single-pin segments, one per
  // pin, because that is what cutting the strips under an IC produces. Each row
  // is true and the pile of them buries the errors, so any non-error code with
  // more than a handful of instances collapses to one line. Errors are never
  // folded — an error you have to click to see is an error you will miss.
  const FOLD_AT = 4;
  const LABELS = {
    'segment-unused': ['unused strip segment', 'unused strip segments'],
    'pin-floating': ['connection with nothing else on its strip',
      'connections with nothing else on their strip'],
  };

  const byCode = new Map();
  for (const f of sorted) {
    if (!byCode.has(f.code)) byCode.set(f.code, []);
    byCode.get(f.code).push(f);
  }

  const loose = [];
  const folds = [];
  for (const [code, group] of byCode) {
    if (group[0].severity !== 'error' && group.length >= FOLD_AT) {
      const [one, many] = LABELS[code] ?? [code, code];
      folds.push(`<details class="fold">
        <summary>${group.length} ${group.length === 1 ? one : many}</summary>
        ${group.map(row).join('')}
      </details>`);
    } else {
      loose.push(...group);
    }
  }

  el.innerHTML = tally
    + (loose.length ? loose.map(row).join('')
      : `<p class="empty">${folds.length ? 'No errors.' : 'Nothing to report.'}</p>`)
    + folds.join('');
}

// The Netlist tab: what the board is SUPPOSED to connect, beside what it does.
//
// The netlist lives on the project, so it travels with the board, reaches the
// live feed, and is there when the board is reopened. A netlist held only in the
// browser would be a second document you could lose.
//
// A SHORT LEADS. Two netlist nets on one strip is damage; a net not yet joined
// up is work outstanding, and the two must never be shown as the same kind of
// thing.
function paintNetlist() {
  const el = $('#tab-netlist');
  if (!el) return;
  const text = state.project.netlist ?? '';

  const editor = `
    <label class="netlist-edit">
      <span>Netlist</span>
      <textarea id="netlistText" rows="8" spellcheck="false"
        placeholder="part U1 xiao&#10;part U2 tmc2209&#10;net 0V   U1.GND U2.GND&#10;net STEP U1.D0  U2.STEP"
        >${escapeHtml(text)}</textarea>
    </label>`;

  if (!text.trim()) {
    el.innerHTML = `${editor}
      <p class="empty">No netlist yet. Write what this board is meant to connect and
      it will be checked against the copper on every edit.</p>`;
    wireNetlistBox();
    return;
  }

  let report;
  try { report = compareToNetlist(state.project, text); }
  catch (e) { el.innerHTML = `${editor}<p class="empty">${escapeHtml(e.message)}</p>`; return wireNetlistBox(); }

  const tally = `<div class="tally">
    <span><b class="${report.shorts.length ? 'error' : 'ok'}">${report.shorts.length}</b> shorts</span>
    <span><b class="ok">${report.satisfied}</b> made</span>
    <span><b class="${report.satisfied === report.total ? 'ok' : 'warning'}">${report.total - report.satisfied}</b> to do</span></div>`;

  const shorts = report.shorts.map((sh) => `
    <div class="row error"><span class="ref">short</span>
      <span class="msg">${escapeHtml(sh.message)}</span></div>`).join('');

  const problems = report.problems.map((p) => `
    <div class="row error"><span class="ref">${p.line ? `line ${p.line}` : '·'}</span>
      <span class="msg">${escapeHtml(p.message)}</span></div>`).join('');

  const rows = [...report.nets]
    .sort((a, b) => (a.status === 'satisfied' ? 1 : 0) - (b.status === 'satisfied' ? 1 : 0)
      || a.name.localeCompare(b.name))
    .map((n) => {
      const detail = n.status === 'satisfied'
        ? `${n.want} pins on one strip`
        : n.groups.map((g) => g.join(' + ')).join('  |  ')
          + (n.absent.length ? `  (not on the board: ${n.absent.join(', ')})` : '');
      return `<div class="row ${n.status === 'satisfied' ? 'ok' : 'warning'}">
        <span class="ref">${escapeHtml(n.name)}</span>
        <span class="msg">${escapeHtml(detail)}</span></div>`;
    }).join('');

  el.innerHTML = `${editor}${tally}${shorts}${problems}${rows}`;
  wireNetlistBox();
}

// Saved when you leave the box, not on every keystroke: a netlist is typed in
// bursts and a commit per character would bury undo.
function wireNetlistBox() {
  const box = $('#netlistText');
  if (!box) return;
  box.addEventListener('change', () => {
    const next = JSON.parse(JSON.stringify(state.project));
    const text = box.value;
    if (text.trim()) next.netlist = text; else delete next.netlist;
    state.project = next;
    commit('netlist updated');
  });
}

// ------------------------------------------------------- the component editor
//
// Peter: "next task is a component editor screen." Every component problem this
// week needed ME to edit source — the JST body was wrong twice, NC3 and NC4 are
// two names only his silkscreen can settle, and his SMT parts want a 1206 land
// the library does not have. He is the one holding the part.
//
// OVER THE BOARD, NOT BESIDE IT. A device has sixteen pin names, a footprint and
// a preview, and none of that fits in a panel next to a board. The board is left
// untouched underneath: this screen hides, it does not replace.

// What is being edited. `null` means nothing chosen; a device with no id is a
// new one that has not been saved.
let devEditing = null;
let devIsNew = false;
let devCatalogue = [];

async function openComponents() {
  $('#componentsScreen').hidden = false;
  await refreshDevices();
  if (!devEditing && devCatalogue.length) await chooseDevice(devCatalogue[0].id);
}

function closeComponents() {
  $('#componentsScreen').hidden = true;
  // The catalogue may have moved, and the palette lists devices.
  paintCards();
  draw('');
}

async function refreshDevices() {
  const { ok, body } = await api('/api/devices');
  if (!ok) return say('could not read the component catalogue');
  devCatalogue = body.devices ?? [];
  paintDeviceList();
  return devCatalogue;
}

// The catalogue, grouped and searchable. Fourteen of the sixteen entries are
// JST variants, so without a search the list is a wall of one connector.
function paintDeviceList() {
  const q = ($('#devSearch')?.value ?? '').trim().toLowerCase();
  const shown = q
    ? devCatalogue.filter((d) => `${d.name} ${d.id} ${d.category}`.toLowerCase().includes(q))
    : devCatalogue;

  // Grouped the way the palette groups parts, so a component is where you
  // already look for it — and under the same headings a person reads there,
  // rather than the internal word.
  const byCat = new Map();
  for (const d of shown) {
    const cat = CATEGORIES.find((c) => c.id === d.category)?.name ?? d.category ?? 'Other';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(d);
  }
  if (!shown.length) {
    $('#devList').innerHTML = `<p class="empty">Nothing matches ${escapeHtml(q)}.</p>`;
    return;
  }
  $('#devList').innerHTML = [...byCat].map(([cat, list]) => `
    <div class="devgroup">${escapeHtml(cat)}</div>
    ${list.map((d) => `
      <button class="devrow${devEditing?.id === d.id ? ' is-on' : ''}" data-device="${escapeHtml(d.id)}">
        <span class="devname">${escapeHtml(d.name)}</span>
        <span class="devmeta"><span class="devpins">${d.pins}</span> pin${d.pins === 1 ? '' : 's'}${
  d.builtIn ? '' : ' · <b>yours</b>'}${
  d.unverifiedPins?.length ? ' · <span class="devwarn">unverified</span>' : ''}</span>
      </button>`).join('')}`).join('');
}

async function chooseDevice(id) {
  const { ok, body } = await api(`/api/devices/${encodeURIComponent(id)}`);
  if (!ok) return say(body?.error ?? 'could not read that component');
  devEditing = body.device;
  devIsNew = false;
  // A pin lit on the last component means nothing on this one.
  devLitPin = null;
  paintDeviceEditor(body.builtIn);
  await refreshDevices();
}

function newDevice() {
  devEditing = {
    id: '', name: '', category: 'module', base: 'dip', span: 4, width: 3,
    refPrefix: 'U', pins: [], pinSource: '',
  };
  devIsNew = true;
  paintDeviceEditor(false);
}

// The pin count a footprint really has, so the name list is the right length
// without the person counting. Derived rather than typed: a caller who has to
// count pins is a caller about to get one wrong.
function pinCountFor(device) {
  const probe = { ref: 'X1', part: device.base, at: { col: 0, row: 0 }, rot: 0 };
  if (device.span != null) probe.span = device.span;
  if (device.width != null) probe.width = device.width;
  try { return resolvePins([probe], getPart).length; } catch { return 0; }
}

function paintDeviceEditor(builtIn) {
  const el = $('#devEdit');
  if (!devEditing) { el.innerHTML = '<p class="empty">Choose a component.</p>'; return; }
  const d = devEditing;
  const want = pinCountFor(d);
  // A PIN WITH NO NAME IS NUMBERED, so a new component is valid the moment it
  // is made and a footprint that grows does not become invalid. It is also the
  // library's own convention: a header and a JST are named by number, because a
  // connector's pins have no function of their own.
  const pins = Array.from({ length: want }, (_, i) => {
    const given = d.pins?.[i];
    return given && String(given).trim() ? given : String(i + 1);
  });
  const unsure = new Set(d.unverifiedPins ?? []);

  // THE LABELS ARE THE LIBRARY'S, NOT MINE. It hands over spanLabel "pins per
  // side" for a DIL, "ways" for a connector and "lead pitch in holes" for an
  // axial part, and widthLabel "body width in holes (3 = 0.3 in)". The first
  // version of this screen wrote "Span" and "Width" over the top of all of it.
  let basePart = null;
  try { basePart = getPart(d.base); } catch { /* an unknown base is reported on save */ }
  const bases = partList().filter((p) => p.kind === 'component');

  const field = (name, label, value, type = 'text', hint = '') => `
    <label class="devfield"><span class="devlabel">${escapeHtml(label)}</span>
      <input data-field="${name}" type="${type}" value="${escapeHtml(value ?? '')}"
        ${type === 'number' ? 'min="1" step="1"' : ''}>
      ${hint ? `<span class="devhint">${escapeHtml(hint)}</span>` : ''}</label>`;

  // WHERE THE PACKAGE TURNS. A DIL runs down one side and back up the other, so
  // the table is split there with the turn named. Eight across put pin 8 and
  // pin 9 — opposite ends of the chip — side by side, which is the opposite of
  // what the numbering means.
  const perSide = basePart?.parametric === 'span' && d.width != null && want > 2
    ? Math.ceil(want / 2)
    : want;
  const sideRows = (from, to, label) => `
    <div class="devside" data-pin-side="${escapeHtml(label)}">
      <div class="devsidelabel">${escapeHtml(label)}</div>
      ${pins.slice(from, to).map((p, i) => {
    const n0 = from + i;
    return `
        <label class="devpin"${unsure.has(p) ? ' data-unverified="true"' : ''}
          data-pin-row="${n0 + 1}">
          <span class="devpinno${n0 === 0 ? ' is-first' : ''}">${n0 + 1}</span>
          <input data-pin-index="${n0}" value="${escapeHtml(p)}" spellcheck="false">
          ${unsure.has(p) ? '<span class="devwarn" title="not verified against the part">unverified</span>' : ''}
        </label>`;
  }).join('')}
    </div>`;

  el.innerHTML = `
    <section class="devpinning">
      <h4 class="devsection">Pins</h4>
      <div class="devsides">
        ${perSide < want
    ? sideRows(0, perSide, 'Pin 1 side') + sideRows(perSide, want, 'The far side')
    : sideRows(0, want, `All ${want}`)}
      </div>
    </section>

    <section class="devpackage">
      <h4 class="devsection">Package</h4>
      <div class="devfields">
        ${devIsNew
    ? field('id', 'Id', d.id, 'text', 'lower case, no spaces')
    : ''}
        ${field('name', 'Name', d.name)}
        <label class="devfield"><span class="devlabel">Footprint</span>
          <select data-field="base">${bases.map((b) => `<option value="${escapeHtml(b.id)}"${
  b.id === d.base ? ' selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}</select>
          <span class="devhint">the shape it solders into</span></label>
        ${basePart?.parametric === 'span'
    ? field('span', capitalise(basePart.spanLabel ?? 'span'), d.span, 'number')
    : ''}
        ${basePart?.defaultWidth != null
    ? field('width', capitalise(basePart.widthLabel ?? 'width'), d.width, 'number')
    : ''}
        ${basePart?.pinsRun ? (() => {
    // WHICH WAY THE PINS CROSS THE STRIPS. Peter: "each lib item needs to
    // somehow identify it's pin -> strip orientation." Lit from the device's own
    // word if it has one, the footprint's if not; a device only stores it when
    // it differs, so correcting a footprint corrects the devices built on it.
    const now = d.pinsRun ?? basePart.pinsRun;
    const opt = (v, label) => `<button type="button" class="devseg-opt${now === v ? ' is-on' : ''}"
      data-pinsrun="${v}" aria-pressed="${now === v}">${label}</button>`;
    // Its own class: `.cuts` is also the layer list, which a later rule makes a
    // column, and borrowing it stacked these three full width.
    return `<div class="devfield"><span class="devlabel">Pins run</span>
          <span class="devseg" role="group" aria-label="Pins run">${opt('across', 'Across')}${opt('along', 'Along')}${opt('either', 'Either')}</span>
          <span class="devhint">${d.pinsRun ? 'set for this component' : 'as the footprint says'}</span></div>`;
  })() : ''}
        ${basePart ? (() => {
    // WHICH SIDE IT MOUNTS ON by default. Stored on the device only when it
    // differs from the footprint's, like Pins run; a placement can still be
    // switched on the board.
    const now = d.side ?? sideOf(basePart);
    const opt = (v, label) => `<button type="button" class="devseg-opt${now === v ? ' is-on' : ''}"
      data-devside="${v}" aria-pressed="${now === v}">${label}</button>`;
    return `<div class="devfield"><span class="devlabel">Mounted on</span>
          <span class="devseg" role="group" aria-label="Mounted on">${opt('top', 'Top')}${opt('copper', 'Copper side')}</span>
          <span class="devhint">${d.side ? 'set for this component' : 'as the footprint says'}</span></div>`;
  })() : ''}
        ${field('refPrefix', 'Reference letter', d.refPrefix, 'text', 'U1, R1, J1 …')}
        <label class="devfield"><span class="devlabel">Silkscreen</span>
          <span class="devcolour"><input data-field="silk" type="color"
            value="${escapeHtml(d.silk ?? '#2f9e44')}"></span></label>
        <label class="devfield devwide"><span class="devlabel">Where the pin names came from</span>
          <input data-field="pinSource" value="${escapeHtml(d.pinSource ?? '')}"
            placeholder="a datasheet, the silkscreen, a board file …">
          <span class="devhint">a name nobody can check is a name nobody should trust</span></label>
      </div>
    </section>`;

  // The header carries the identity: the name big, and the id, footprint and pin
  // count as one spec line. The id used to be a disabled text input, which looks
  // like a field you may edit and is not.
  $('#devName').textContent = d.name || (devIsNew ? 'New component' : d.id);
  $('#devSpec').innerHTML = [
    `<span class="mono">${escapeHtml(d.id || '—')}</span>`,
    escapeHtml(basePart?.name ?? d.base ?? ''),
    `${want} pin${want === 1 ? '' : 's'}`,
    builtIn === false ? '<b>yours</b>' : 'stock',
    unsure.size ? `<span class="devwarn">${unsure.size} unverified</span>` : '',
  ].filter(Boolean).join(' · ');

  $('#devRevert').hidden = builtIn !== false;
  $('#devStatus').textContent = '';
  paintDevicePreview();
}

const capitalise = (s) => String(s ?? '').charAt(0).toUpperCase() + String(s ?? '').slice(1);

// THE DRAWING, AS THE COMPONENT ACTUALLY SITS ON A BOARD.
//
// Drawn by the same renderer the board uses, because a preview from a second
// drawing path would be a second thing to keep in step.
//
// ROTATED, WHICH IS THE WHOLE POINT. Every device used to be previewed at rot 0,
// so a DIP's pins ran ALONG the strips and every pin shorted to its neighbour.
// Peter: "the DIP is mis-orientated ... with the strips being inline with the
// pins instead of across them." It is shown the way it will place — across the
// strips, or along one for an SMT package, as its `pinsRun` says — with the cuts
// the package itself declares, which is what makes this a stripboard footprint
// rather than a generic one.
//
// A SCRAP OF BOARD FOR ONE PART: the pins' own block plus one strip all round,
// with the placement shifted onto it. Shared by this preview and the Library's
// footprints, so the two can never disagree about how a part is framed.
//
// Built, not mutated: the caller's placement is copied, and the project never
// leaves the caller.
function scrapProjectFor(placement) {
  const pl = { ...placement, at: { col: 1, row: 1 } };
  const at1 = resolvePins([pl], getPart);
  const cs = at1.map((q) => q.col);
  const rs = at1.map((q) => q.row);
  // Shift so the top-left pin lands one strip in from the corner, then make the
  // board that block plus the same strip on the far side.
  pl.at = { col: 1 + (1 - Math.min(...cs)), row: 1 + (1 - Math.min(...rs)) };
  const cols = Math.max(...cs) - Math.min(...cs) + 3;
  const rows = Math.max(...rs) - Math.min(...rs) + 3;
  return { ...makeProject({ cols, rows, name: 'preview' }), placements: [pl] };
}

function paintDevicePreview() {
  const el = $('#devDrawing');
  if (!el || !devEditing) return;
  const d = devEditing;
  const span = d.span ?? 4;
  const width = d.width ?? 3;

  // THE BOARD IS DERIVED FROM WHERE THE PINS LAND, not guessed from span and
  // width.
  //
  // Guessing got it wrong twice in one sitting. `width + 2` put the whole far
  // side of every DIP off the substrate, because a dual-row package's two pin
  // columns are `width` holes APART and so need width + 1 columns before any
  // margin. `width + 3` fixed that and left the package two strips from one
  // edge and hard against the other, and a single-row JST in the left third
  // with three dead columns beside it — dead board is scale not spent on the
  // part, which is what put the names at 7px in the first place.
  //
  // resolvePins already knows the answer: it is the same function the renderer
  // and the DRC use to say where a placement's pins are. Ask it, then wrap the
  // result in one strip of margin. That is right for a DIP, a single-row
  // connector and anything added later, without this function knowing which.
  const pl = {
    ref: `${d.refPrefix ?? 'U'}1`,
    part: d.base,
    at: { col: 1, row: 1 },
    // At the rotation it will actually PLACE at, derived from which way its pins
    // run. This was a hard-coded 90 — right for a DIP, and wrong for anything
    // built on an SMT package, whose pins share a strip at 0.
    rot: defaultRotOf(getPart(d.base), d.pinsRun),
  };
  if (d.pinsRun) pl.pinsRun = d.pinsRun;
  if (d.side) pl.side = d.side;
  if (d.span != null) pl.span = d.span;
  if (d.width != null) pl.width = d.width;
  if (d.silk) pl.silk = d.silk;
  if (d.pins?.length) pl.pinNames = [...d.pins];
  if (d.unverifiedPins?.length) pl.unverifiedPins = [...d.unverifiedPins];

  const p = scrapProjectFor(pl);
  try {
    el.innerHTML = renderBoard(p, {
      theme: state.theme,
      // A copper-side part from the copper side: that is the face it is built
      // from, and from the top a SOT-23 is its own mirror image.
      view: sideOf(getPart(d.base), pl) === 'copper' ? 'underside' : 'top',
      // No row and column labels: this is one part on a scrap, not a board you
      // find holes on.
      layers: { ...DEFAULT_LAYERS, pinNames: false, netNames: false, drc: false, labels: false, edgeLabels: false },
    });
  } catch (e) {
    el.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`;
    return;
  }
  cropToWhatIsDrawn(el.querySelector('svg'));
  numberThePads();
}

// CROP THE PREVIEW TO WHAT IS ACTUALLY ON IT.
//
// renderBoard reserves 3.2 holes either side for a net name that has been pushed
// off the edge, and keeps the reserve permanently so a board does not resize
// under the pointer when somebody types a name. That is right for the board and
// wrong here: this preview turns the net-name layer off, so nothing can ever be
// drawn there, and the reserve was eating 46% of the drawing's width — which is
// the whole of why the pin names came out at 7px.
//
// Cropping is done here rather than in the renderer on purpose. Tying the gutter
// to the layer would make the real board reflow the moment net names are hidden,
// which is the exact jump that comment exists to prevent.
function cropToWhatIsDrawn(svg) {
  if (!svg?.getBBox) return;
  let box;
  try { box = svg.getBBox(); } catch { return; }   // not laid out yet
  if (!(box.width > 0 && box.height > 0)) return;
  const pad = PITCH_MM * 0.35;                      // enough that the edge is not flush
  svg.setAttribute('viewBox',
    `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`);
}

// EVERY PAD CARRIES ITS NUMBER, laid over the drawing rather than drawn into it.
//
// A datasheet numbers the pins on the package outline; that is how you check a
// part against the thing in your hand. The renderer's job is the board, so the
// numbers are an overlay positioned from the pads it already marks — no second
// geometry, and the renderer keeps its one job.
//
// PIN 1 IS FILLED, not merely square. Peter: "in the image pin 1 is not shown."
// The renderer does draw it square, and at preview size that is invisible.
function numberThePads() {
  const host = $('#devDrawing');
  const svg = host?.querySelector('svg');
  if (!svg) return;
  const pads = [...svg.querySelectorAll('[data-kind="pad"]')];
  if (!pads.length) return;

  const box = svg.getBoundingClientRect();
  const hostBox = host.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'devbadges';
  // THE OVERLAY IS THE DRAWING'S OWN BOX, not the padded area around it. That is
  // what lets a name say "outside this edge" and mean the margin, and it makes
  // every percentage below line up with the pad it came from.
  layer.style.left = `${box.left - hostBox.left}px`;
  layer.style.top = `${box.top - hostBox.top}px`;
  layer.style.width = `${box.width}px`;
  layer.style.height = `${box.height}px`;

  // The middle of the package, so a pad knows which way is OUT. The renderer's
  // own pin-name layer draws names beside the pads and inward, which at this
  // size ran two columns of them together into DIRSTEPNC3NC4SPREADMS2. A name
  // placed outboard has the whole margin to itself.
  const centres = pads.map((pad) => {
    const r = pad.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const midX = (Math.min(...centres.map((c) => c.x)) + Math.max(...centres.map((c) => c.x))) / 2;
  const midY = (Math.min(...centres.map((c) => c.y)) + Math.max(...centres.map((c) => c.y))) / 2;

  // WHICH LAYOUT THE PADS ALLOW. Reading inward from each pad needs two COLUMNS
  // of pins with the package between them — a DIP. A single column has no
  // inside, so its callouts stay to one side as before. Anything else — a
  // SOT-23's 2+1, an 0603's two pads side by side — has no room between the
  // pads at all: inward, pins 1 and 2 grew into each other and G vanished
  // under S. Those go above or below their pad instead.
  const columns = [];
  for (const c of centres) {
    const col = columns.find((g) => Math.abs(g.x - c.x) < 2);
    if (col) col.n += 1; else columns.push({ x: c.x, n: 1 });
  }
  const twoColumns = columns.length === 2 && columns.every((g) => g.n >= 2);
  const oneColumn = columns.length === 1;
  const sideOfPad = (c) => {
    if (twoColumns) return c.x < midX - 1 ? 'left' : 'right';
    if (oneColumn) return 'right';
    return c.y < midY - 1 ? 'above' : 'below';
  };

  for (const [i, pad] of pads.entries()) {
    const c = centres[i];
    const top = `${(c.y - box.top) / box.height * 100}%`;
    const side = sideOfPad(c);

    // ONE CALLOUT PER PIN, IN THE MARGIN, JUSTIFIED TOWARD THE BOARD.
    //
    // Peter: "the pin number or name should be shown right and left justified
    // towards the centre instead on over the pin. closest to the pin will be the
    // pin number, the next col will be pin name."
    //
    // So nothing sits over the pad. The row is flush against the drawing's edge
    // and its two cells are ordered by which side it is on: number innermost,
    // name outboard of it. A flex row does the justification, so neither column
    // has to know how wide "16" is against "1".
    // INSIDE THE OUTLINE, reading inward from the pad. Anchored to the pad's own
    // edge rather than the drawing's, so the two cells grow toward the middle of
    // the package and the number is always the one touching the pad.
    const padPct = (c.x - box.left) / box.width * 100;
    const row = document.createElement('div');
    row.className = 'devcallout';
    row.dataset.side = side;
    row.style.top = top;
    // Above or below: centred on the pad and lifted clear of it by the pad's OWN
    // size. A fixed 14px was under half a pad at preview zoom, so each name sat
    // on the pad it labels.
    if (side === 'left' || side === 'above' || side === 'below') row.style.left = `${padPct}%`;
    else row.style.right = `${100 - padPct}%`;
    if (side === 'above' || side === 'below') {
      const clear = pad.getBoundingClientRect().height / 2 + 6;
      row.style.transform = side === 'above'
        ? `translate(-50%, calc(-100% - ${clear}px))`
        : `translate(-50%, ${clear}px)`;
    }

    const num = document.createElement('button');
    num.className = 'devbadge';
    num.type = 'button';
    num.dataset.pinBadge = String(i + 1);
    if (i === 0) num.dataset.first = 'true';
    num.textContent = String(i + 1);
    num.title = `Pin ${i + 1}${devEditing?.pins?.[i] ? ` — ${devEditing.pins[i]}` : ''}`;

    const name = document.createElement('span');
    name.className = 'devpinname';
    name.dataset.pinName = String(i + 1);
    name.dataset.side = side;
    // A JST's pin names ARE 1, 2, 3, 4 — "the connector's own numbering, a JST
    // pin has no function of its own" — so printing the name beside the badge
    // rendered every callout as "1 1". A name that only repeats the number
    // carries nothing the badge has not already said.
    const given = devEditing?.pins?.[i] ?? '';
    name.textContent = given === String(i + 1) ? '' : given;

    // Reading inward from the pad: number, then name. On the left that is the
    // document order; on the right it is reversed, so the number still ends up
    // against the pad. Peter's own diagram:
    //     | pin number name            name number pin |
    // Above or below there is no inward, so it reads left to right: number, name.
    if (side === 'right') { row.append(name, num); } else { row.append(num, name); }
    layer.appendChild(row);
  }
  host.appendChild(layer);
  if (devLitPin) lightPin(devLitPin);
}

// The drawing and the table are ONE INSTRUMENT. Peter: "I cannot select a pin
// and the related field is highlighted." Either direction, because somebody
// holding the part starts at the drawing and somebody checking a netlist starts
// at the table.
let devLitPin = null;

function lightPin(n) {
  devLitPin = n;
  for (const b of document.querySelectorAll('#devDrawing [data-pin-badge]')) {
    b.dataset.lit = String(Number(b.dataset.pinBadge) === n);
  }
  for (const t of document.querySelectorAll('#devDrawing [data-pin-name]')) {
    t.dataset.lit = String(Number(t.dataset.pinName) === n);
  }
  for (const row of document.querySelectorAll('#devEdit [data-pin-row]')) {
    row.dataset.lit = String(Number(row.dataset.pinRow) === n);
  }
}

// Read the form back into the device being edited.
function readDeviceForm() {
  const d = { ...devEditing };
  for (const input of $('#devEdit').querySelectorAll('[data-field]')) {
    const key = input.dataset.field;
    const raw = input.value;
    if (key === 'span' || key === 'width') d[key] = raw === '' ? null : Number(raw);
    else d[key] = raw;
  }
  d.pins = [...$('#devEdit').querySelectorAll('[data-pin-index]')].map((i) => i.value.trim());
  // A name the person has just typed is better sourced than anything I put in
  // the catalogue, so it stops being flagged — the same rule setPinNames uses.
  d.unverifiedPins = (devEditing.unverifiedPins ?? [])
    .filter((name) => d.pins.includes(name) && devEditing.pins?.[d.pins.indexOf(name)] === name);
  return d;
}

async function saveDevice() {
  const d = readDeviceForm();
  if (!d.id) { $('#devStatus').textContent = 'give it an id first'; return; }
  const { ok, body } = await api(`/api/devices/${encodeURIComponent(d.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ device: d }),
  });
  // REFUSED, NOT SWALLOWED. The catalogue validates at the door and the reason
  // has to reach whoever typed it — a save that quietly did nothing would be
  // worse than one that failed loudly.
  if (!ok) { $('#devStatus').textContent = body?.error ?? 'that component was refused'; return; }
  devEditing = body.device;
  devIsNew = false;
  $('#devStatus').textContent = `saved ${d.id}`;
  installDevices(await fetchStoredDevices());
  paintDeviceEditor(body.builtIn);
  await refreshDevices();
}

async function revertDevice() {
  if (!devEditing?.id) return;
  const { ok, body } = await api(`/api/devices/${encodeURIComponent(devEditing.id)}`, { method: 'DELETE' });
  if (!ok) { $('#devStatus').textContent = body?.error ?? 'nothing stored to undo'; return; }
  devEditing = body.device;
  $('#devStatus').textContent = `${body.id} is back to stock`;
  installDevices(await fetchStoredDevices());
  paintDeviceEditor(body.builtIn);
  await refreshDevices();
}

// The catalogue as this browser should hold it: the full merged set, so the
// palette and anything that places a part agree with the server.
async function fetchStoredDevices() {
  const { ok, body } = await api('/api/devices');
  if (!ok) return [];
  const full = [];
  for (const d of body.devices ?? []) {
    if (d.builtIn) continue;
    const one = await api(`/api/devices/${encodeURIComponent(d.id)}`);
    if (one.ok) full.push(one.body.device);
  }
  return full;
}

function paintNets() {
  const { nets, segmentNet } = netsFor(state.project);
  const allLabels = netLabelsAllByNet(state.project, segmentNet);

  // A net has no stable identity — n0 means "the net holding the top-left-most
  // segment" — so a name is anchored to a HOLE. The anchor is the first hole of
  // the net's first segment, which is stable under every edit that does not
  // destroy it. See src/model/nets.js.
  const anchorOf = (netObj) => {
    const [row, idx] = netObj.segments[0].split(':').slice(1).map(Number);
    void idx;
    const seg = segments(state.project.board, effectiveBreaks(state.project))
      .find((g) => g.id === netObj.segments[0]);
    return seg ? { col: seg.x0, row } : null;
  };

  const problems = netLabelProblems(state.project, segmentNet);
  const conflicts = problems.filter((p) => p.code === 'net-name-conflict');
  const warn = conflicts.length
    ? `<p class="hint" style="color:var(--error)">${escapeHtml(conflicts[0].message)}</p>`
    : '';
  // NAMES ON NO NET. A name on a hole a spot-face removed belongs to no net, so
  // it had no row below and no way to be reached — Peter's MS1. Listed here with
  // its hole and a Clear, so a name that cannot be seen can still be removed.
  const stranded = problems.filter((p) => p.code === 'net-name-stranded');
  const strandedHtml = stranded.length ? `
    <h4 class="nets-sub">Names on no net</h4>
    ${stranded.map((p) => {
    const h = p.holes[0];
    const key = `${h.col},${h.row}`;
    return `<div class="row" data-stranded="${key}">
      <span class="ref mono">${escapeHtml(p.refs[0])}</span>
      <span class="msg">${escapeHtml(p.where)}, ${escapeHtml(p.reason)}</span>
      <button class="linky" data-clear-label="${key}">Clear</button>
    </div>`;
  }).join('')}` : '';

  $('#tab-nets').innerHTML = warn + (nets.map((netObj) => {
    const a = anchorOf(netObj);
    const anchor = a ? `${a.col},${a.row}` : '';
    // ONE FIELD PER STORED LABEL, not one per net. A name belongs to a hole, so
    // a net can carry several — and when it did, only the first had a field.
    // The rest could not be renamed or cleared, and nothing on screen said
    // where they were. An unnamed net gets one empty field at its anchor, which
    // is how a name is added.
    const mine = allLabels.get(netObj.id) ?? [];
    const rows = mine.length ? mine : [{ name: '', colour: undefined, hole: a }];
    const picked = state.selection?.kind === 'net' && state.selection.ref === netObj.id;
    const heading = mine.length
      ? mine.map((l) => l.name).filter(Boolean).join(' · ') || netObj.id
      : netObj.id;
    const editor = (label) => {
      // Each field carries its OWN hole, so it edits the label it shows.
      const at = label.hole ? `${label.hole.col},${label.hole.row}` : anchor;
      return `
    <div class="net-edit">
      <input data-netname="${at}" value="${escapeHtml(label.name ?? '')}"
        placeholder="name this net" style="width:104px">
      <span class="sw-now" style="background:${label.colour ?? 'transparent'}"></span>
      ${PALETTE_16.slice(0, 8).map((cc) => `<button class="sw" data-netcolour="${at}"
        data-hex="${cc.hex}" style="background:${cc.hex}" title="${cc.name}"></button>`).join('')}
      <button class="sw sw-clear" data-netcolour="${at}" data-hex=""
        title="No colour">&times;</button>
    </div>`;
    };
    return `
    <div class="row${picked ? ' is-net-on' : ''}" data-net="${netObj.id}"
      ${picked ? 'data-selected="true"' : ''}>
      <span class="ref mono">${escapeHtml(heading)}</span>
      <span class="msg">${netObj.segments.length} segment${netObj.segments.length === 1 ? '' : 's'},
        ${netObj.pins.length} connection${netObj.pins.length === 1 ? '' : 's'}</span>
    </div>${rows.map(editor).join('')}`;
  }).join('') || '<p class="empty">No nets.</p>') + strandedHtml;

  // Clearing a stranded name: the one way to reach it. The buttons are new on
  // every repaint, so their listeners are too — nothing piles up.
  for (const b of $('#tab-nets').querySelectorAll('[data-clear-label]')) {
    b.addEventListener('click', () => {
      const [col, row] = b.dataset.clearLabel.split(',').map(Number);
      const name = state.project.netLabels?.[b.dataset.clearLabel]?.name ?? 'name';
      // Through ops.setLabel, which lets a clear through on a dead hole.
      const out = ops.setLabel(state.project, { col, row }, { name: '' });
      if (out.error) return say(out.error);
      state.project = out.project;
      commit(`cleared ${name}, which named nothing`);
    });
  }

  for (const input of $('#tab-nets').querySelectorAll('[data-netname]')) {
    input.addEventListener('change', (e) => {
      const [col, row] = e.target.dataset.netname.split(',').map(Number);
      const existing = labelAt(col, row);
      // Through ops.setLabel, so the mouse and the API name a net by one rule.
      const out = ops.setLabel(state.project, { col, row },
        { name: e.target.value.trim(), colour: existing.colour });
      if (out.error) return say(out.error);
      state.project = out.project;
      commit(e.target.value.trim() ? `net named ${e.target.value.trim()}` : 'net name cleared');
    });
  }
  for (const sw of $('#tab-nets').querySelectorAll('[data-netcolour]')) {
    sw.addEventListener('click', (e) => {
      const [col, row] = e.currentTarget.dataset.netcolour.split(',').map(Number);
      const existing = labelAt(col, row);
      const out = ops.setLabel(state.project, { col, row },
        { name: existing.name, colour: e.currentTarget.dataset.hex || undefined });
      if (out.error) return say(out.error);
      state.project = out.project;
      commit('net colour changed');
    });
  }
}

// The label stored against this hole, if any.
const labelAt = (col, row) => state.project.netLabels?.[`${col},${row}`] ?? {};

// A net's name if it has one, else its id — so the status line says "GND"
// rather than "n3" once a net has been named.
function netName(sel) {
  if (sel?.kind !== 'net') return sel?.ref ?? '';
  const { segmentNet } = netsFor(state.project);
  return netLabelsByNet(state.project, segmentNet).get(sel.ref)?.name ?? sel.ref;
}

function paintRunList() {
  const list = runList(state.project);
  $('#tab-runlist').innerHTML = list.length
    ? `<p class="hint">Build the board from this. Each row is one pen wire.</p>`
      + list.map((w) => `
      <div class="row" data-wire="${w.ref}">
        <span class="ref">${w.ref}</span>
        <span class="msg mono">(${w.from.col},${w.from.row}) → (${w.to.col},${w.to.row})</span>
      </div>`).join('')
    : '<p class="empty">No wires yet. Pick the Wire tool and click two holes.</p>';
}

// The panel is rebuilt only when its SHAPE changes. Rebuilding on every edit
// replaced the input being typed into: the value committed, the field vanished
// with the focus and caret, and one change worked before the field went dead.
let inspectorShape = null;

function syncInspectorValues(includeFocused = false) {
  const sel = state.selection;
  if (!sel) return;
  const focused = includeFocused ? null : document.activeElement;
  const put = (el, v) => {
    // Never write into the field being typed in — that would fight the caret
    // even without a rebuild. It catches up the moment focus leaves. A REFUSED
    // edit is the exception: there the whole point is to put the rejected value
    // back, so it passes includeFocused.
    if (el && el !== focused) el.value = v;
  };
  if (sel.kind === 'part') {
    const pl = state.project.placements.find((x) => x.ref === sel.ref);
    if (!pl) return;
    const part = getPart(pl.part);
    put($('[data-edit="ref"]'), pl.ref);
    put($('[data-edit="value"]'), pl.value ?? '');
    put($('[data-edit="span"]'), pl.span ?? part.defaultSpan ?? '');
    put($('[data-edit="width"]'), pl.width ?? part.defaultWidth ?? '');
    put($('[data-edit="rot"]'), String(pl.rot ?? 0));
    put($('[data-edit="col"]'), pl.at.col);
    put($('[data-edit="row"]'), pl.at.row);
  } else if (sel.kind === 'wire') {
    const w = state.project.wires.find((x) => x.ref === sel.ref);
    if (!w) return;
    put($('[data-wedit="ref"]'), w.ref);
    put($('[data-wedit="from.col"]'), w.from.col);
    put($('[data-wedit="from.row"]'), w.from.row);
    put($('[data-wedit="to.col"]'), w.to.col);
    put($('[data-wedit="to.row"]'), w.to.row);
  }
}

function paintInspector(force = false) {
  const sel = state.selection;
  // A net's target is the derived net itself, so its key reads `net:n0` rather
  // than falling through the "the thing is gone" branch.
  const target = sel?.kind === 'part'
    ? state.project.placements.find((x) => x.ref === sel.ref)
    : sel?.kind === 'wire'
      ? state.project.wires.find((x) => x.ref === sel.ref)
      : sel?.kind === 'net'
        ? netsFor(state.project).nets.find((x) => x.id === sel.ref)
        : null;
  let part = null;
  if (sel?.kind === 'part' && target) {
    try { part = getPart(target.part); } catch { /* unknown */ }
  }
  const shape = inspectorKey(sel, target, part);

  if (!force && shape !== null && shape === inspectorShape) {
    syncInspectorValues();
    return;
  }
  inspectorShape = shape;
  paintInspectorFrom();
}

function paintInspectorFrom() {
  const el = $('#tab-inspect');
  const sel = state.selection;
  if (!sel) { el.innerHTML = '<p class="empty">Nothing selected.</p>'; return; }

  if (sel.kind === 'net') {
    // A net opens the Nets tab, so this is not what you are looking at — but it
    // must not say "Nothing selected" while something is.
    const { nets, segmentNet } = netsFor(state.project);
    const netObj = nets.find((x) => x.id === sel.ref);
    if (!netObj) { el.innerHTML = '<p class="empty">That net is gone.</p>'; return; }
    const label = netLabelsByNet(state.project, segmentNet).get(sel.ref);
    el.innerHTML = `
      <div class="field"><span>Net</span>
        <span class="mono">${escapeHtml(label?.name ?? netObj.id)}</span></div>
      ${label?.colour ? `<div class="field"><span>Colour</span>
        <span class="sw-now" style="background:${label.colour}"></span></div>` : ''}
      <div class="field"><span>Strips</span>
        <span class="mono">${netObj.segments.length}</span></div>
      <div class="field"><span>Connections</span>
        <span class="mono">${netObj.pins.length}</span></div>
      <p class="hint">Name and colour it in the <b>Nets</b> tab.</p>`;
    return;
  }

  if (sel.kind === 'break') {
    const [row, x] = sel.ref.split(',').map(Number);
    // Look in the EFFECTIVE cuts: a cut a part requires is derived, so it is not
    // in project.breaks and would otherwise inspect as a generic knife cut.
    const br = effectiveBreaks(state.project).find((b) => b.row === row && b.x === x);
    const at = br?.at ?? 'gap';

    if (br?.owner) {
      el.innerHTML = `
        <div class="field"><span>Cut for</span><span class="mono">${escapeHtml(br.owner)}</span></div>
        <div class="field"><span>Row</span><span class="mono">${row}</span></div>
        <div class="field"><span>Between</span><span class="mono">holes ${x} and ${x + 1}</span></div>
        <p class="hint">${escapeHtml(br.owner)} cannot work unless this strip is cut, so
          the cut belongs to it: move ${escapeHtml(br.owner)} and it follows, delete
          ${escapeHtml(br.owner)} and it goes.</p>`;
      return;
    }

    el.innerHTML = at === 'hole'
      ? `<div class="field"><span>Spot-face</span><span class="mono">hole ${x}, row ${row}</span></div>
         <p class="hint">The cutter takes the copper off around the hole, so the
           strip is severed <em>and</em> the hole connects to nothing. A lead
           soldered here is mechanical only.</p>
         <button id="delBreak">Restore the copper</button>`
      : `<div class="field"><span>Knife cut</span><span class="mono">row ${row}</span></div>
         <div class="field"><span>Between</span><span class="mono">holes ${x} and ${x + 1}</span></div>
         <p class="hint">A cut in the gap between two holes — both holes keep
           their copper.</p>
         <button id="delBreak">Restore the copper</button>`;
    $('#delBreak')?.addEventListener('click', () => {
      // Through ops.clearBreak. This wrote state.project.breaks directly, and
      // the check written to catch that only knew the spelling `p.breaks`.
      const out = ops.clearBreak(state.project, { row, x });
      if (out.error) return say(out.error);
      state.project = out.project;
      state.selection = null;
      commit(`restored the copper at row ${row}`);
    });
    return;
  }

  if (sel.kind === 'wire') {
    const wi = state.project.wires.findIndex((x) => x.ref === sel.ref);
    if (wi < 0) { el.innerHTML = '<p class="empty">Gone.</p>'; return; }
    const w = state.project.wires[wi];
    el.innerHTML = `
      <div class="field"><span>Wire</span>
        <input data-wedit="ref" value="${escapeHtml(w.ref)}" style="width:90px"></div>
      <div class="field"><span>Value</span>
        <input data-wedit="value" value="${escapeHtml(w.value ?? '')}"
          placeholder="GND, +5V" style="width:90px"></div>
      <div class="field"><span>Label colour</span>
        <span class="sw-now" style="background:${w.silk ?? THEME_SILK[state.theme]}"></span></div>
      <div class="swatches">${PALETTE_16.map((cc) =>
    `<button class="sw${w.silk === cc.hex ? ' is-on' : ''}" data-wswatch="silk"
        data-hex="${cc.hex}" style="background:${cc.hex}" title="${cc.name}"></button>`).join('')}
        <button class="sw sw-clear${w.silk ? '' : ' is-on'}" data-wswatch="silk"
          data-hex="" title="Default">&times;</button></div>
      <div class="field"><span>Colour</span>
        <span class="sw-now" style="background:${wireColour(w)}" title="in use"></span></div>
      <div class="swatches" data-for="wire-colour">${PALETTE_16.map((cc) =>
    `<button class="sw${w.colour === cc.hex ? ' is-on' : ''}" data-wswatch="colour"
        data-hex="${cc.hex}" style="background:${cc.hex}" title="${cc.name}"></button>`).join('')}
        <button class="sw sw-clear${w.colour ? '' : ' is-on'}" data-wswatch="colour"
          data-hex="" title="Default">&times;</button></div>
      <p class="hint">${wireLengthHoles(w)} holes long, so the 0&ndash;9 code makes it
        ${escapeHtml(COLOUR_CODE[wireLengthHoles(w) % COLOUR_CODE.length].name)}.</p>
      <div class="field"><span>From column</span>
        <input type="number" data-wedit="from.col" value="${w.from.col}" min="0"></div>
      <div class="field"><span>From row</span>
        <input type="number" data-wedit="from.row" value="${w.from.row}" min="0"></div>
      <div class="field"><span>To column</span>
        <input type="number" data-wedit="to.col" value="${w.to.col}" min="0"></div>
      <div class="field"><span>To row</span>
        <input type="number" data-wedit="to.row" value="${w.to.row}" min="0"></div>
      <p class="hint" id="editError"></p>`;

    for (const sw of el.querySelectorAll('[data-wswatch]')) {
      sw.addEventListener('click', (e) => {
        const out = ops.editWire(state.project, state.selection?.ref,
          e.currentTarget.dataset.wswatch, e.currentTarget.dataset.hex);
        if (out.error) { $('#editError').textContent = out.error; return; }
        state.project = out.project;
        inspectorShape = null;
        commit(`${out.ref} ${e.currentTarget.dataset.wswatch} `
          + `${e.currentTarget.dataset.hex || 'default'}`);
      });
    }

    for (const input of el.querySelectorAll('[data-wedit]')) {
      input.addEventListener('change', (e) => {
        const field = e.target.dataset.wedit;
        // Same as for placements: read the current wire, not a captured copy.
        const out = ops.editWire(state.project, state.selection?.ref, field, e.target.value);
        if (out.error) { syncInspectorValues(true); $('#editError').textContent = out.error; return; }
        state.project = out.project;
        if (field === 'ref') state.selection = { kind: 'wire', ref: out.ref };
        commit(`${out.ref} ${field} = ${e.target.value}`);
      });
    }
    return;
  }

  const idx = state.project.placements.findIndex((x) => x.ref === sel.ref);
  if (idx < 0) { el.innerHTML = '<p class="empty">Gone.</p>'; return; }
  const pl = state.project.placements[idx];
  const part = getPart(pl.part);
  const can = editableFields(part);

  const num = (field, val, extra = '') => `<input type="number" data-edit="${field}"`
    + ` value="${val}" ${extra}>`;

  el.innerHTML = `
    <div class="field"><span>Part</span><span>${escapeHtml(
    // The device when it is one — a TMC2209 read as "DIP / IC socket" — and
    // the footprint beside it, which is still worth knowing.
    pl.device && getDevice(pl.device)
      ? `${getDevice(pl.device).name} (${part.name})`
      : part.name)}</span></div>
    ${pl.pinSource ? `<p class="hint" data-focus-pinsource><b>Pin names from</b>
      ${escapeHtml(pl.pinSource)}</p>` : ''}
    ${pl.unverifiedPins?.length ? `<p class="hint" data-focus-unverified style="color:var(--warning)">
      <b>Unverified: ${escapeHtml(pl.unverifiedPins.join(', '))}</b> — check
      ${pl.unverifiedPins.length === 1 ? 'this' : 'these'} against the part before wiring to
      ${pl.unverifiedPins.length === 1 ? 'it' : 'them'}.</p>` : ''}
    <div class="field"><span>Ref</span>
      <input data-edit="ref" value="${escapeHtml(pl.ref)}" style="width:90px"></div>
    <div class="field"><span>Value</span>
      <input data-edit="value" value="${escapeHtml(pl.value ?? '')}" style="width:90px"></div>
    ${swatches('silk', pl.silk, silkOf(pl, part, THEME_SILK[state.theme]), 'Silkscreen')}
    ${part.kind === 'link'
    ? swatches('colour', pl.colour, linkColour(pl, part), 'Wire')
    : ''}
    ${can.includes('autoBreak') ? `<div class="field"><span>Cuts its own strips</span>
      <input type="checkbox" data-edit="autoBreak"
        ${pl.autoBreak === false ? '' : 'checked'}></div>
      <p class="hint">Turn this off to cut the strips under it yourself. Until you
        do, the package is reported as shorted pin to pin.</p>` : ''}
    ${can.includes('span') ? `<div class="field"><span>${escapeHtml(part.spanLabel ?? 'Span')}</span>
      ${num('span', pl.span ?? part.defaultSpan, `min="${part.minSpan ?? 1}"`)}</div>` : ''}
    ${can.includes('width') ? `<div class="field"><span>${escapeHtml(part.widthLabel ?? 'Width')}</span>
      ${num('width', pl.width ?? part.defaultWidth, `min="${part.minWidth ?? 2}"`)}</div>` : ''}
    <div class="field"><span>Rotation</span>
      <select data-edit="rot">${[0, 90, 180, 270].map((r) =>
    `<option value="${r}"${(pl.rot ?? 0) === r ? ' selected' : ''}>${r}°</option>`).join('')}</select></div>
    ${can.includes('side') ? (() => {
    // WHICH SIDE OF THE BOARD. Peter: "an item / component / object needs to be
    // able to switch layer but have a default layer, mostly top." Two buttons,
    // not a dropdown — one click, and the current side is visible without
    // opening anything.
    const now = sideOf(part, pl);
    const opt = (v, label) => `<button type="button" class="devseg-opt${now === v ? ' is-on' : ''}"
      data-edit-side="${v}" aria-pressed="${now === v}">${label}</button>`;
    return `<div class="field"><span>Side</span>
      <span class="devseg" role="group" aria-label="Side of the board">${opt('top', 'Top')}${opt('copper', 'Copper side')}</span></div>`;
  })() : ''}
    <div class="field"><span>Column</span>${num('col', pl.at.col, 'min="0"')}</div>
    <div class="field"><span>Row</span>${num('row', pl.at.row, 'min="0"')}</div>
    <p class="hint" id="editError"></p>`;

  // The side choice: one click, one commit, one undo step.
  for (const b of el.querySelectorAll('[data-edit-side]')) {
    b.addEventListener('click', (e) => {
      const ref = state.selection?.ref;
      const value = e.currentTarget.dataset.editSide;
      const out = ops.setSide(state.project, ref, value);
      if (out.error) { $('#editError').textContent = out.error; return; }
      state.project = out.project;
      inspectorShape = null;          // which button is lit changed, so repaint
      commit(`${ref} to the ${value === 'top' ? 'top' : 'copper side'}`);
    });
  }

  // One commit per change event, not per keystroke, so an edit is one undo step.
  for (const sw of el.querySelectorAll('[data-swatch]')) {
    sw.addEventListener('click', (e) => {
      const field = e.currentTarget.dataset.swatch;
      const hex = e.currentTarget.dataset.hex;
      const ref = state.selection?.ref;
      const out = ops.editPart(state.project, ref, field, hex);
      if (out.error) { $('#editError').textContent = out.error; return; }
      state.project = out.project;
      inspectorShape = null;          // the swatch selection changed, so repaint
      commit(`${ref} ${field} ${hex || 'default'}`);
    });
  }

  for (const input of el.querySelectorAll('[data-edit]')) {
    input.addEventListener('change', (e) => {
      const field = e.target.dataset.edit;
      const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      // Look the placement up NOW rather than using the one captured when this
      // panel was built. The panel no longer rebuilds after every edit, so a
      // captured copy goes stale: editing span would write back a placement
      // still carrying the width from before the last two edits, silently
      // undoing them.
      // Through ops.editPart: the same rules, plus the board's own — a ref
      // renamed onto another part's is refused here rather than on save.
      const out = ops.editPart(state.project, state.selection?.ref, field, value);
      if (out.error) {
        // Put the rejected value back — including into the focused field, which
        // is the one that holds it — and leave the field itself alone so the
        // user can correct it without clicking back in.
        syncInspectorValues(true);
        $('#editError').textContent = out.error;
        return;
      }
      state.project = out.project;
      const placement = state.project.placements.find((x) => x.ref === out.ref);
      if (field === 'ref') state.selection = { kind: 'part', ref: placement.ref };
      // The autoBreak checkbox changes whether the hint below it applies, so the
      // panel's shape changed and it has to be rebuilt rather than value-synced.
      if (field === 'autoBreak') inspectorShape = null;
      commit(`${placement.ref} ${field} = ${value}`);
    });
  }
}

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ------------------------------------------------------------------ hit tests

// Where did the pointer land, in board coordinates? Read straight off the
// element, so the answer is whatever the renderer actually drew.
function hitHole(target) {
  const el = target.closest('[data-hole]');
  if (!el) return null;
  const [col, row] = el.getAttribute('data-hole').split(',').map(Number);
  return { col, row };
}

// A break is claimed by clicking nearer the gap than the hole. The SVG is in
// millimetres, so the pointer is converted through the SVG's own CTM rather than
// by re-deriving the scale.
function pointerHole(evt) {
  const svg = $('#boardWrap svg');
  if (!svg) return null;
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const PITCH = 2.54;
  const b = state.project.board;
  const x = state.view === 'underside' ? b.cols * PITCH - p.x : p.x;
  return { x, y: p.y, col: Math.round(x / PITCH - 0.5), row: Math.round(p.y / PITCH - 0.5) };
}

// ---------------------------------------------------------------------- tools

function onBoardClick(evt) {
  const p = state.project;
  const pos = pointerHole(evt);

  // Hit-test the drawn hole first, and fall back to the pointer arithmetic when
  // there is no element to hit. Without the fallback, hiding the holes layer
  // silently disables the place and wire tools — the layer would switch off two
  // tools as well as a picture.
  const hole = hitHole(evt.target) ?? (
    pos && pos.col >= 0 && pos.row >= 0 && pos.col < p.board.cols && pos.row < p.board.rows
      ? { col: pos.col, row: pos.row }
      : null
  );

  switch (state.tool) {
    case 'place': {
      if (!hole) return;
      const part = getPart(state.part);
      // THROUGH ops.addPart, like every other edit now. A device resolves to its
      // real span, width, silk and pin names there — the same code the API uses,
      // so a XIAO placed by clicking and a XIAO placed over HTTP are the same
      // XIAO.
      const placed = ops.addPart(p, state.device
        ? { device: state.device, at: hole, rot: state.rot }
        : {
          part: state.part,
          at: hole,
          rot: state.rot,
          span: part.parametric ? state.span : undefined,
          width: part.defaultWidth != null ? state.width : undefined,
        });
      if (placed.error) return say(placed.error);
      state.project = placed.project;
      const pl = state.project.placements.find((x) => x.ref === placed.ref);
      state.selection = { kind: 'part', ref: pl.ref };

      // The cuts this part needs are DERIVED from the placement, not inserted
      // here. That is why they follow it when it turns and go with it when it is
      // deleted — there is no stored copy to get out of step.
      const need = requiredBreaks(pl, getPart).length;
      commit(need
        ? `placed ${pl.ref}, which cuts ${need} strip${need === 1 ? '' : 's'} under it`
        : `placed ${pl.ref}`);
      return;
    }

    case 'break': {
      if (!pos) return;
      const PITCH = 2.54;
      const row = pos.row;
      if (row < 0 || row >= p.board.rows) return say('that is not on the board');

      // A knife cut is indexed by the GAP the pointer is nearest; a spot-face by
      // the HOLE it is nearest. Half a hole apart, and getting it wrong is the
      // defect that produces a drill list off by one.
      const x = state.cut === 'hole'
        ? Math.round(pos.x / PITCH - 0.5)
        : Math.round(pos.x / PITCH) - 1;
      const last = state.cut === 'hole' ? p.board.cols - 1 : p.board.cols - 2;
      if (x < 0 || x > last) {
        return say(state.cut === 'hole' ? 'that is not a hole' : 'that is not a gap between two holes');
      }

      // Either kind of cut in the same place replaces the other, rather than
      // stacking two cuts on one spot.
      const found = p.breaks.findIndex((bk) => bk.row === row && bk.x === x
        && (bk.at ?? 'gap') === state.cut);
      if (found >= 0) {
        const cleared = ops.clearBreak(p, { row, x });
        if (cleared.error) return say(cleared.error);
        state.project = cleared.project;
        return commit(state.cut === 'hole'
          ? `restored the copper at hole (${x},${row})`
          : `restored row ${row} between holes ${x} and ${x + 1}`);
      }
      const cut = ops.setBreak(p, { row, x, at: state.cut });
      if (cut.error) return say(cut.error);
      state.project = cut.project;
      return commit(state.cut === 'hole'
        ? `spot-faced hole (${x},${row}) — it now connects to nothing`
        : `cut row ${row} between holes ${x} and ${x + 1}`);
    }

    case 'wire': {
      if (!hole) return say('click a hole');
      if (!state.wireStart) {
        state.wireStart = hole;
        // draw, not say: the marker and the band are the feedback that matters.
        // The status line is at the bottom edge, nowhere near where you clicked.
        return draw(`wire from (${hole.col},${hole.row}) — click the other end`);
      }
      if (state.wireStart.col === hole.col && state.wireStart.row === hole.row) {
        state.wireStart = null;
        return draw('cancelled — a wire needs two different holes');
      }
      // THE SAME RULES THE API APPLIES. A pen wire into an occupied hole is
      // refused here exactly as it is refused over HTTP — one board, one set of
      // rules. It was two, and the looser one was the one a person used.
      //
      // penWiresSignalsOnly WARNS rather than refuses at the mouse: Peter's own
      // board carries pen wires drawn before that rule existed, and a rule that
      // makes an existing board unusable is a rule nobody keeps. It shows in
      // Checks, where he can see it and decide.
      const from = state.wireStart;
      const made = ops.addWire(p, from, hole, { warnOnly: warnOnlyFor('editor') });
      if (made.error) {
        state.wireStart = null;
        return draw(made.error);
      }
      state.project = made.project;
      state.wireStart = null;
      state.selection = { kind: 'wire', ref: made.ref };
      commit(`${made.ref}: (${from.col},${from.row}) → (${hole.col},${hole.row})`);
      return;
    }

    case 'move': {
      // Two clicks, no guessing: pick a pin, then pick the hole it goes in.
      const padEl = evt.target.closest('[data-kind="pad"]');
      const partEl = evt.target.closest('[data-kind="part"]');

      if (padEl && partEl) {
        const ref = partEl.getAttribute('data-ref');
        const pin = padEl.getAttribute('data-pin');
        const pl2 = p.placements.find((x) => x.ref === ref);
        const where = pl2 ? pinLocation(pl2, getPart, pin) : null;
        // Clicking another pin before choosing a hole RE-ARMS rather than
        // moving: picking up the wrong pin should cost a click, not an undo.
        state.moveAnchor = where ? { ref, pin, ...where } : null;
        state.selection = { kind: 'part', ref };
        return draw(`holding ${ref} by pin ${pin} — click the hole it goes in`);
      }

      if (!state.moveAnchor) return say('click a pin of the device you want to move');
      if (!hole) return say('click a hole');

      const from = state.moveAnchor;
      const moved = ops.movePart(p, from.ref, from.pin, hole);
      state.moveAnchor = null;
      if (moved.error) return draw(moved.error);
      state.project = moved.project;
      return commit(`${from.ref} pin ${from.pin} moved to (${hole.col},${hole.row})`);
    }

    case 'delete': {
      // Delete fires once: having removed something, the tool disarms, so the
      // next click cannot take a second thing with it. A MISS does not disarm —
      // you are still aiming at what you meant to hit.
      // Disarm first, commit second: setTool says the new tool's help text, so
      // the other order replaced "deleted R1" with a hint the instant it
      // appeared.
      const removed = (label) => {
        const next = toolAfterDelete(true);
        if (next) setTool(next);
        commit(label);
      };
      const partEl = evt.target.closest('[data-kind="part"]');
      // wire-pad first: with no line drawn, the pads ARE the wire on the board.
      const wireEl = evt.target.closest(
        // wire-pad-hit is the invisible target painted ABOVE the components, so
        // a pad under a DIP is reachable. It carries the same data-ref, so it is
        // treated as the wire it stands for.
        '[data-kind="wire-pad"], [data-kind="wire-pad-hit"],'
        + ' [data-kind="wire"], [data-kind="wire-label"]',
      );
      // break-hit is the invisible target painted above the parts, so a cut
      // under a component is reachable. It carries the same data-break, so it
      // is treated as the cut it stands for.
      const breakEl = evt.target.closest('[data-kind="break"], [data-kind="break-hit"]');
      if (partEl) {
        const ref = partEl.getAttribute('data-ref');
        const gone = ops.removePart(p, ref);
        if (gone.error) return say(gone.error);
        state.project = gone.project;
        state.selection = null;
        return removed(`deleted ${ref}`);
      }
      if (wireEl) {
        const ref = wireEl.getAttribute('data-ref');
        const gone = ops.removeWire(p, ref);
        if (gone.error) return say(gone.error);
        state.project = gone.project;
        state.selection = null;
        return removed(`deleted ${ref}`);
      }
      if (breakEl) {
        const [row, x] = breakEl.getAttribute('data-break').split(',').map(Number);
        const owner = ownerOf(p, row, x);
        if (owner) {
          return say(`that cut belongs to ${owner} — move or delete ${owner} instead`);
        }
        const cleared = ops.clearBreak(p, { row, x });
        if (cleared.error) return say(cleared.error);
        state.project = cleared.project;
        return removed(`restored the copper at row ${row}`);
      }
      return say('nothing there to delete');
    }

    default: {
      const partEl = evt.target.closest('[data-kind="part"]');
      // wire-pad first: with no line drawn, the pads ARE the wire on the board.
      const wireEl = evt.target.closest(
        // wire-pad-hit is the invisible target painted ABOVE the components, so
        // a pad under a DIP is reachable. It carries the same data-ref, so it is
        // treated as the wire it stands for.
        '[data-kind="wire-pad"], [data-kind="wire-pad-hit"],'
        + ' [data-kind="wire"], [data-kind="wire-label"]',
      );
      // break-hit is the invisible target painted above the parts, so a cut
      // under a component is reachable. It carries the same data-break, so it
      // is treated as the cut it stands for.
      const breakEl = evt.target.closest('[data-kind="break"], [data-kind="break-hit"]');
      // Read before the reset below: clicking a strip twice has to compare
      // against what WAS selected, and `else state.selection = null` runs first.
      const was = state.selection;
      if (partEl) state.selection = { kind: 'part', ref: partEl.getAttribute('data-ref') };
      else if (wireEl) state.selection = { kind: 'wire', ref: wireEl.getAttribute('data-ref') };
      else if (breakEl) {
        state.selection = { kind: 'break', ref: breakEl.getAttribute('data-break') };
      } else state.selection = null;

      const copper = evt.target.closest('[data-kind="copper"]');
      if (copper && !partEl && !wireEl && !breakEl) {
        const { segmentNet } = netsFor(p);
        const netId = segmentNet[copper.getAttribute('data-seg')];
        // Selecting the same strip again clears it, as it always did — but it is
        // a selection now, so it brings the Nets tab forward and marks its row.
        const already = was?.kind === 'net' && was.ref === netId;
        state.selection = already ? null : { kind: 'net', ref: netId };
      }
      const what = { part: 'part', wire: 'wire', break: 'break at', net: 'net' };
      draw(state.selection
        ? `selected ${what[state.selection.kind]} ${netName(state.selection)}`
        : '');
    }
  }
}

// -------------------------------------------------------------------- palette

// ------------------------------------------------------------------- cards
//
// The left panel was four unrelated things stacked, with the chosen part's span
// and width and the break tool's cut type floating free of what they configure.
// Now each card owns its own settings, and arming a tool opens the card that
// holds them.
//
// Layers and Board are never opened by a tool: they are a view concern and a
// document concern, not any tool's settings.

function buildCards() {
  $('#cards').innerHTML = CARDS.map((c) => `
    <section class="card" data-card="${c.id}">
      <div class="card-headrow">
        <button class="card-head" data-cardtoggle="${c.id}">
          <span class="card-icon">${c.icon}</span>
          <span class="card-title">${c.title}</span>
          <span class="card-sub" data-cardsub="${c.id}"></span>
          <span class="card-chev">▾</span>
        </button>
        <!-- A card's own controls sit BESIDE its header button, never inside
             it: a button inside a button is invalid and takes the click. -->
        <span class="card-tools" data-cardtools="${c.id}"></span>
      </div>
      <div class="card-body" data-cardbody="${c.id}" hidden></div>
    </section>`).join('');

  // A card body's own change listeners, attached ONCE, here, where the bodies are
  // made. They were added inside paintLayers and paintRules, which run on every
  // repaint, and piled up until a layer toggle hung the page.
  $('[data-cardbody="layers"]').addEventListener('change', onLayerChange);
  $('[data-cardbody="rules"]').addEventListener('change', onRuleChange);

  for (const b of $('#cards').querySelectorAll('[data-cardtoggle]')) {
    b.addEventListener('click', () => {
      // Opened by hand stays open until a tool that owns a card is armed.
      state.openCard = state.openCard === b.dataset.cardtoggle ? null : b.dataset.cardtoggle;
      paintCards();
    });
  }
  paintCards();
}

function paintCards() {
  for (const c of CARDS) {
    const open = state.openCard === c.id;
    $(`[data-cardbody="${c.id}"]`).hidden = !open;
    $(`[data-card="${c.id}"]`).classList.toggle('is-open', open);
  }
  // The header says what the next click will do even when collapsed.
  const part = getPart(state.part);
  $('[data-cardsub="library"]').textContent = part ? part.name : '';
  const off = LAYER_ROWS.filter(([k]) => !state.layers[k]).length;
  $('[data-cardsub="layers"]').textContent = off ? `${off} hidden` : '';
  // WHICH BOARD, not how big. The card is collapsed by default, so this line was
  // the only place the open board could be named and it was showing "25 × 20" —
  // the size is set by two inputs a few pixels below, inside the card.
  const named = Boolean(state.project.name) && state.project.name !== 'untitled';
  $('[data-cardsub="board"]').textContent = named
    ? state.project.name
    : `${state.project.board.cols} × ${state.project.board.rows}`;
  // And in the toolbar, where the eye goes for "which document is this".
  // The toolbar button says the board's NAME, or "Boards" when there is not one
  // yet. It must never fall back to the size: that sat inches from the size
  // inputs and read as a second, disagreeing copy of them.
  const label = $('#boardLabel');
  if (label) label.textContent = named ? state.project.name : 'Boards';
  // The label is capped with an ellipsis so a long name cannot push the toolbar
  // off the screen; the whole name is the button's tooltip.
  $('#boards')?.setAttribute('title', named
    ? `${state.project.name} — pick a board, or start a new one`
    : 'Pick a board, or start a new one');
  syncBoardSize();

  // The list / tiles toggle, top right of the Library header. Only while the
  // card is open: it controls a body you cannot otherwise see. It shows the
  // view a click will GIVE you, and says so in words for a screen reader.
  const libTools = $('[data-cardtools="library"]');
  if (libTools) {
    const toTiles = state.libView !== 'tiles';
    libTools.innerHTML = state.openCard === 'library'
      ? `<button class="card-tool" data-libview-toggle
          title="${toTiles ? 'Show as tiles' : 'Show as a list'}"
          aria-label="${toTiles ? 'Show as tiles' : 'Show as a list'}">${toTiles
  ? '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1"/><rect x="9" y="9" width="5.5" height="5.5" rx="1"/></svg>'
  : '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.5" y="2" width="3.5" height="3" rx="0.6"/><rect x="1.5" y="6.5" width="3.5" height="3" rx="0.6"/><rect x="1.5" y="11" width="3.5" height="3" rx="0.6"/><path d="M7 3.5h7.5M7 8h7.5M7 12.5h7.5"/></svg>'}</button>`
      : '';
  }

  if (state.openCard === 'library') paintLibrary();
  if (state.openCard === 'layers') paintLayers();
  if (state.openCard === 'rules') paintRules();
  if (state.openCard === 'board') paintBoardCard();
}

// The Rules card, RENDERED FROM THE RULE DEFINITIONS.
//
// Nothing here names a rule. Adding one to RULE_DEFS in src/model/rules.js gives
// it a row, a label and its help text with no edit to this file — which is what
// "this list will grow so it needs to be configurable" has to mean. Three
// checkboxes typed in here would be a second list of rules, disagreeing with the
// first within a month.
// A rule changed. Attached ONCE to the Rules card body, in buildCards.
function onRuleChange(e) {
  const id = e.target.dataset.rule;
  if (!id) return;
  const def = RULE_DEFS.find((d) => d.id === id);
  if (!def) return;
  const patch = def.kind === 'boolean'
    ? { [id]: e.target.checked }
    // A dotted id is a path: netClasses.power becomes {netClasses:{power:[...]}}
    : pathPatch(id, e.target.value.split('\n').map((s) => s.trim()).filter(Boolean));
  const out = ops.setRules(state.project, patch);
  // REFUSED, NOT SWALLOWED. A pattern that does not compile is a rule that
  // would silently never fire; the status line is where the person who just
  // typed it is still looking.
  if (out.error) { paintRules(); return say(out.error); }
  state.project = out.project;
  commit(def.kind === 'boolean'
    ? `${def.label}: ${e.target.checked ? 'on' : 'off'}`
    : `${def.label} updated`);
  paintRules();
}

function paintRules() {
  const body = $('[data-cardbody="rules"]');
  if (!body) return;
  const rules = rulesFor(state.project);
  const own = state.project.rules ?? {};

  const row = (def) => {
    const value = ruleValue(rules, def.id);
    const changed = ruleValue(DEFAULT_RULES, def.id) !== undefined
      && JSON.stringify(value) !== JSON.stringify(ruleValue(DEFAULT_RULES, def.id));
    // THE DEFAULT IS SHOWN BESIDE ANYTHING CHANGED. A rule quietly switched off
    // weeks ago is how a board gets built wrong by someone who believes they
    // are protected.
    const flag = changed ? '<span class="rule-changed" title="changed from the default">changed</span>' : '';
    if (def.kind === 'boolean') {
      return `<label class="rule ${value ? '' : 'is-off'}">
        <input type="checkbox" data-rule="${def.id}" ${value ? 'checked' : ''}>
        <span class="rule-label">${escapeHtml(def.label)}${flag}</span>
        <span class="rule-help">${escapeHtml(def.help)}</span>
      </label>`;
    }
    // patterns: one per line, because that is how they are read and edited.
    return `<div class="rule">
      <span class="rule-label">${escapeHtml(def.label)}${flag}</span>
      <span class="rule-help">${escapeHtml(def.help)}</span>
      <textarea class="rule-patterns" rows="4" data-rule="${def.id}"
        spellcheck="false">${escapeHtml((value ?? []).join('\n'))}</textarea>
    </div>`;
  };

  body.innerHTML = `<div class="rules">${RULE_DEFS.map(row).join('')}</div>
    ${Object.keys(own).length ? '<button id="rulesReset" class="linky">back to the defaults</button>' : ''}`;

  // No listener on `body` here, for the reason paintLayers gives: the body
  // survives the repaint. onRuleChange is attached once, in buildCards.
  $('#rulesReset')?.addEventListener('click', () => {
    const next = JSON.parse(JSON.stringify(state.project));
    delete next.rules;
    state.project = next;
    commit('rules back to the defaults');
    paintRules();
  });
}

// {a.b: v} -> {a: {b: v}} — so a rule id can be a path without the panel knowing
// the shape of the rule set.
function pathPatch(id, value) {
  const parts = String(id).split('.');
  return parts.reverse().reduce((acc, key) => ({ [key]: acc }), value);
}

// A PART'S FOOTPRINT, for the Library. Drawn by renderBoard on a scrap of board
// sized to the part, so the Library shows exactly what placing it will draw —
// including, until parts declare which way their pins cross the strips, a DIP
// whose pins run along them, because that is how it places today.
//
// Cropped by drawingExtentMm rather than by measuring the DOM, so it needs no
// layout and can be cached: the catalogue does not change between repaints, the
// theme does. Every data-* attribute is stripped, so nothing that hit-tests the
// board by data-kind or data-ref can ever mistake a thumbnail for a real part.
const thumbCache = new Map();

function libraryThumb(item) {
  // A device's own pinsRun is in the key: changing it on the Components screen
  // turns the footprint, and a cache keyed on id alone would keep the old one.
  const key = `${item.isDevice ? `d:${getDevice(item.id)?.pinsRun ?? ''}:${getDevice(item.id)?.side ?? ''}` : 'p'}:${item.id}:${state.theme}`;
  if (thumbCache.has(key)) return thumbCache.get(key);

  let svg = '';
  try {
    const base = item.isDevice ? getDevice(item.id)?.base : item.id;
    const part = base ? getPart(base) : null;
    if (part && placesWith(part) !== 'wire') {
      const pl = item.isDevice
        ? placementFor(item.id, { col: 0, row: 0 }, defaultRotOf(part, getDevice(item.id)?.pinsRun), 'X1')
        : { ref: 'X1', part: item.id, at: { col: 0, row: 0 }, rot: defaultRotOf(part) };
      const project = scrapProjectFor(pl);
      const e = drawingExtentMm(project, getPart);
      const { cols, rows } = project.board;
      const pad = PITCH_MM * 0.25;
      const x0 = Math.min(0, e.x) - pad;
      const y0 = Math.min(0, e.y) - pad;
      const x1 = Math.max(cols * PITCH_MM, e.x + e.w) + pad;
      const y1 = Math.max(rows * PITCH_MM, e.y + e.h) + pad;
      svg = renderBoard(project, {
        theme: state.theme,
        // A copper-side part is built from the underside, so that is its face.
        // The placement's side, so a device that mounts underneath says so.
        view: sideOf(part, pl) === 'copper' ? 'underside' : 'top',
        layers: { ...DEFAULT_LAYERS, labels: false, pinNames: false, netNames: false, drc: false, edgeLabels: false },
      })
        .replace(/viewBox="[^"]*"/, `viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}"`)
        .replace(/ data-[a-z-]+="[^"]*"/g, '')
        .replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
    }
  } catch { svg = ''; }

  // Point to point has no footprint: it is drawn between two holes you choose.
  // A stand-in says that rather than leaving a blank.
  if (!svg) {
    svg = '<svg viewBox="0 0 24 16" aria-hidden="true" focusable="false" class="lib-stand-in">'
      + '<circle cx="5" cy="11" r="2.4"/><circle cx="19" cy="5" r="2.4"/>'
      + '<path d="M7 10 L17 6"/></svg>';
  }
  thumbCache.set(key, svg);
  return svg;
}

// The quiet second line: what tells two similar names apart without reading
// them twice. Pins, and which side it is soldered to; for a device, the package
// it is built on and whether any of its pin names are unverified.
function librarySub(item) {
  if (item.isDevice) {
    const d = getDevice(item.id);
    const base = d ? getPart(d.base) : null;
    const bits = [`${d?.pins?.length ?? 0} pins`, base?.name].filter(Boolean).map(escapeHtml);
    if (item.unverifiedPins?.length) bits.push('<span class="lib-warn">unverified</span>');
    return bits.join(' · ');
  }
  const part = getPart(item.id);
  // Wire-only first: point to point is also kind 'link', and it does not join
  // the strips it lies over — it joins the two holes you pick.
  if (placesWith(part) === 'wire') return 'wire · hole to hole';
  if (part.kind === 'link') return 'link · joins strips';
  const n = pinsOf(part).length;
  return [`${n} ${n === 1 ? 'pin' : 'pins'}`, sideOf(part) === 'copper' ? 'copper side' : null]
    .filter(Boolean).join(' · ');
}

function paintLibrary() {
  // Devices sit in the SAME list as the generic parts, grouped by the same
  // categories — a XIAO under Modules, a JST beside the pin header. A separate
  // "devices" list would be a second place to look for a component, and the
  // question you are asking is "what am I placing", not "is it a preset".
  const all = [...partList(), ...deviceList().map((d) => ({
    id: d.id, name: d.name, category: d.category, kind: 'component',
    isDevice: true, unverifiedPins: d.unverifiedPins,
  }))];
  const groups = groupParts(filterParts(all, state.search), CATEGORIES);
  const part = getPart(state.part);
  const armedDevice = state.device ? getDevice(state.device) : null;

  // A part's parameters appear directly beneath IT, not in the panel. That is
  // the whole complaint: span belongs to the resistor, not to the sidebar.
  const paramsHtml = (p) => {
    // A device has no parameters to offer: its span and width came with it.
    if (p.isDevice) return '';
    if (p.id !== state.part || state.device) return '';
    const fields = paramsFor(getPart(p.id));
    if (!fields.length) return '';
    return `<div class="part-params">${fields.map((f) => `
      <label>${escapeHtml(f.label)}
        <input type="number" data-param="${f.field}" min="${f.min}"
          value="${state[f.field] ?? f.value}"></label>`).join('')}</div>`;
  };

  const tiles = state.libView === 'tiles';
  const searching = Boolean(state.search.trim());
  const isOn = (p) => (p.isDevice ? p.id === state.device : p.id === state.part && !state.device);

  // ONE ITEM, WHETHER PART OR DEVICE. They used to be two: the style named
  // button[data-part], so a device fell through to the default bordered,
  // centred button and the XIAO looked like a different kind of thing.
  const itemHtml = (p) => `
    <button ${p.isDevice ? `data-device="${p.id}"` : `data-part="${p.id}"`}
      class="lib-item ${isOn(p) ? 'is-on' : ''}" title="${escapeHtml(p.name)}">
      <span class="lib-thumb">${libraryThumb(p)}</span>
      <span class="lib-text">
        <span class="lib-name">${escapeHtml(p.name)}</span>
        <span class="lib-sub">${librarySub(p)}</span>
      </span>
    </button>`;

  const body = $('[data-cardbody="library"]');
  body.dataset.libview = state.libView;
  body.innerHTML = `
    <input id="libsearch" class="lib-search" placeholder="search parts"
      value="${escapeHtml(state.search)}">
    ${groups.map((g) => {
    // A search shows its matches even in a folded group: a search that hides
    // its own results is a search that lies.
    const folded = state.libCollapsed.has(g.id) && !searching;
    // In tiles, a part's settings cannot fit beneath a half-width tile, so they
    // open beneath its group's grid instead.
    const chosen = g.parts.find((p) => isOn(p));
    return `<section class="lib-grp">
      <button class="lib-group" data-libgroup="${g.id}" data-count="${g.parts.length}"
        aria-expanded="${!folded}">
        <span class="lib-chev" aria-hidden="true">▾</span>
        <span class="lib-gname">${escapeHtml(g.name)}</span>
        <span class="lib-count">${g.parts.length}</span>
      </button>
      <div class="lib-items" data-libgroup-body="${g.id}" ${folded ? 'hidden' : ''}>
        ${g.parts.map((p) => itemHtml(p) + (tiles ? '' : paramsHtml(p))).join('')}
      </div>
      ${tiles && chosen && !folded ? paramsHtml(chosen) : ''}
    </section>`;
  }).join('')
    || '<p class="empty">Nothing matches.</p>'}
    ${armedDevice?.unverifiedPins?.length ? `<p class="hint" style="color:var(--warning)">
      ${escapeHtml(armedDevice.unverifiedPins.join(', '))}
      ${armedDevice.unverifiedPins.length === 1 ? 'is a pin whose name could' : 'are pins whose names could'}
      not be sourced. Check ${armedDevice.unverifiedPins.length === 1 ? 'it' : 'them'}
      against the module before you wire to ${armedDevice.unverifiedPins.length === 1 ? 'it' : 'them'}.</p>` : ''}
    <p class="hint">${armedDevice
    ? escapeHtml(`${armedDevice.name}: ${armedDevice.pins.length} pins, named. `
      + 'Its size and pin names come with it.')
    : (part ? escapeHtml(partHint(part)) : '')}</p>
    <p class="hint">These are the settings for the <b>next</b> part you place.
      To change one already on the board, select it and use <b>Focus</b>.</p>`;

  const search = $('#libsearch');
  search.addEventListener('input', (e) => {
    state.search = e.target.value;
    paintLibrary();
    $('#libsearch').focus();
  });
  for (const input of $('[data-cardbody="library"]').querySelectorAll('[data-param]')) {
    input.addEventListener('change', (e) => {
      state[e.target.dataset.param] = Math.max(1, Number(e.target.value) || 1);
      draw('');
    });
  }
  markPaletteArmed();
}

function partHint(part) {
  const bits = [part.kind === 'link'
    ? 'A link is zero-ohm: it joins the strips it bridges into one net.'
    : 'A component sits between nets — it never joins two strips.'];
  if ((part.side ?? 'top') === 'copper') {
    bits.push('Soldered to the copper underneath, straddling a cut.');
  }
  if (part.requiresBreak) bits.push('Placing it cuts the strips it needs.');
  return bits.join(' ');
}

// paintCutting is gone with the Cutting card. Its one setting is now the pair of
// break buttons in the toolbar — see index.html and setTool.

function paintBoardCard() {
  // The card that owns the DOCUMENT: which board this is, what it is called, and
  // how big. The board list lives here rather than in the toolbar because the
  // toolbar already overflows at 1280, and because "which board am I editing" is
  // a property of the document, not a tool.
  const open = state.boards.find((b) => b.slug === state.slug);
  $('[data-cardbody="board"]').innerHTML = `
    <label class="span-row">Name
      <input id="boardName" type="text" value="${escapeHtml(state.project.name ?? '')}"
        placeholder="name this board"></label>
    ${state.slug ? `<p class="hint">boards/${escapeHtml(state.slug)}.json${
  open?.version ? ` — ${escapeHtml(open.version.slice(0, 8))}` : ''}</p>`
    : '<p class="hint" style="color:var(--warning)">Not saved on the server yet.</p>'}
    <div class="board-list">
      ${state.boards.map((b) => `
        <button data-open-board="${escapeHtml(b.slug)}"
          class="${b.slug === state.slug ? 'is-on' : ''}">
          ${escapeHtml(b.name)}<span class="kind">${b.parts ?? 0} parts</span>
        </button>`).join('') || '<p class="empty">No boards on the server yet.</p>'}
    </div>
    <button id="newBoard">New board…</button>
    <p class="hint">The board's size is in the toolbar, beside the view.</p>`;
  // THE SIZE INPUTS ARE NOT HERE. They were, with the same ids as the toolbar's,
  // so $('#cols') always found the toolbar's one: the card's inputs never got a
  // handler and the toolbar's only got one after this card had been opened once.
  // Two elements, one id, one handler, and no combination a person would find —
  // which is why Peter could not resize a board. One control, in the toolbar,
  // where it is always visible.

  $('#boardName').addEventListener('change', (e) => renameBoard(e.target.value));
  $('#newBoard').addEventListener('click', () => {
    const name = window.prompt('Name the new board');
    if (name) newBoard(name);
  });
  for (const b of $('[data-cardbody="board"]').querySelectorAll('[data-open-board]')) {
    b.addEventListener('click', () => openBoard(b.dataset.openBoard));
  }
}

// The size inputs, wired ONCE at boot rather than from a panel painter. Bound
// inside the painter they only existed after that card had been opened, which
// is half of why resizing did not work.
function wireBoardSize() {
  for (const id of ['#cols', '#rows']) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('change', () => {
      state.project.board.cols = Math.max(4, Number($('#cols').value) || 25);
      state.project.board.rows = Math.max(2, Number($('#rows').value) || 20);
      commit(`board is ${state.project.board.cols} × ${state.project.board.rows}`);
    });
  }
}

// The toolbar's boxes show the board that is open, not the one that was open
// when the page loaded.
function syncBoardSize() {
  const c = $('#cols');
  const r = $('#rows');
  if (c) c.value = state.project.board.cols;
  if (r) r.value = state.project.board.rows;
}

function buildPalette() {
  paintCards();
}

// A part shows as ARMED only while the tool that uses it is armed.
//
// The palette marked an item from state.part while setTool only touched the
// toolbar, so they were independent: Escape armed Select and left a part lit,
// the board looked ready to place, and clicking did nothing. Nothing on screen
// said why.
function markPaletteArmed() {
  const armed = state.tool === 'place' || state.tool === 'wire';
  const body = $('[data-cardbody="library"]');
  if (body) body.classList.toggle('is-armed', armed);
}

// Did this tool have something to act on already? Returns true when it did the
// work, so setTool leaves the tool where it was.
//
// A NET IS NOT AN OBJECT YOU CAN DELETE OR MOVE. Selecting a strip and pressing
// Delete must not do something surprising to the copper, so only a part or a pen
// wire counts here.
function actOnSelection(tool) {
  const sel = state.selection;
  if (!sel || (sel.kind !== 'part' && sel.kind !== 'wire')) return false;
  const p = state.project;

  if (tool === 'delete') {
    const gone = sel.kind === 'part' ? ops.removePart(p, sel.ref) : ops.removeWire(p, sel.ref);
    if (gone.error) return false;                          // nothing matched
    state.project = gone.project;
    state.selection = null;
    // DISARM FIRST, COMMIT SECOND. setTool says the new tool's help text, so
    // committing first left "deleted R1" on screen for an instant and then
    // replaced it with "Click a part or wire to select it" — the one message
    // that mattered, overwritten by a hint.
    const next = toolAfterDelete(true);
    if (next && next !== 'delete') setTool(next);
    commit(`deleted ${sel.ref}`);
    return true;
  }

  if (tool === 'move' && sel.kind === 'part') {
    // Held by PIN 1 — the pin every part has, marked square on the board, and
    // the one a person points at when they say "this part". Picking another pin
    // still re-arms, because that is what the move tool already does.
    const pl = p.placements.find((x) => x.ref === sel.ref);
    const part = pl && getPart(pl.part);
    const pin = part ? pinLabel(part, 0) : null;
    const where = pl && pin ? pinLocation(pl, getPart, pin) : null;
    if (!where) return false;
    state.tool = 'move';
    state.wireStart = null;
    state.moveAnchor = { ref: sel.ref, pin, ...where };
    for (const b of document.querySelectorAll('.tool')) {
      b.classList.toggle('is-on', b.dataset.tool === 'move');
    }
    $('#boardWrap').style.cursor = cursorFor('move');
    draw(`holding ${sel.ref} by pin ${pin} — click the hole it goes in`);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------- wiring

function setTool(tool) {
  // VERB AFTER NOUN, as well as noun after verb.
  //
  // Peter: "sometimes I will select a component then press the move/delete etc
  // button, but sometimes I will select the move/delete etc and then select the
  // component. only the latter is now supported." Rotate already worked the
  // first way, which is exactly why the other two stood out.
  //
  // Only for the tools that act on an object that already exists. Place, wire
  // and break need a HOLE, and a selection is not one.
  if (actOnSelection(tool)) return;

  state.tool = tool;
  state.wireStart = null;
  state.moveAnchor = null;
  // A tool button may carry its own cut style — the two break buttons do — so
  // only the one matching the armed cut lights up. Without the second test both
  // would light whenever break was armed, and the toolbar would be saying the
  // knife and the spot-face are the same thing.
  // And a button that arms a particular PART — the wire link — lights only when
  // that part is the one armed, with plain Place unlit, so one armed tool never
  // shows as two lit buttons.
  const quickParts = new Set([...document.querySelectorAll('.tool[data-quick-part]')]
    .map((b) => b.dataset.quickPart));
  const quickArmed = !state.device && quickParts.has(state.part);
  for (const b of document.querySelectorAll('.tool')) {
    let mine = b.dataset.tool === tool
      && (!b.dataset.cut || b.dataset.cut === state.cut);
    if (mine && b.dataset.tool === 'place') {
      mine = b.dataset.quickPart ? quickArmed && b.dataset.quickPart === state.part : !quickArmed;
    }
    b.classList.toggle('is-on', mine);
  }
  // Set here, the one place the armed tool changes, so the cursor cannot drift
  // out of step with the button the toolbar shows as lit. Board only — a
  // crosshair over the parts list would be nonsense.
  $('#boardWrap').style.cursor = cursorFor(tool);
  // Arming a tool opens the card holding its settings. A tool that configures
  // nothing leaves whatever is open alone, rather than closing the panel for no
  // reason.
  const card = cardForTool(tool);
  if (card) state.openCard = card;
  paintCards();
  markPaletteArmed();
  const help = {
    select: 'Click a part or wire to select it; click a strip to highlight its net.',
    place: 'Click a hole to drop the palette part. R rotates.',
    break: state.cut === 'hole'
      ? 'Click a hole to spot-face it. The hole itself goes dead. Click again to restore it.'
      : 'Click between two holes to cut the strip there. Click again to restore it.',
    wire: 'Click one hole, then another. The wire gets the next free ref.',
    move: 'Click a pin of a device, then the hole that pin should sit in.',
    delete: 'Click a part, wire or break to remove it.',
  };
  say(help[tool]);
}

function boot() {
  buildTabs();
  buildCards();
  wireBoardSize();
  syncBoardSize();
  setTool('select');

  document.addEventListener('click', (evt) => {
    const tool = evt.target.closest('.tool');
    if (tool) {
      // A button that carries a cut style arms that style with the tool. Set
      // BEFORE setTool, which is what decides which of the two lights up.
      if (tool.dataset.cut) state.cut = tool.dataset.cut;
      // A button that carries a part arms that part first, exactly as choosing
      // it in the Library does: no device, its derived rotation.
      if (tool.dataset.quickPart) {
        state.part = tool.dataset.quickPart;
        state.device = null;
        state.rot = defaultRotOf(getPart(state.part));
        buildPalette();
      }
      return setTool(tool.dataset.tool);
    }

    // The Library's list / tiles toggle, and a group heading folding its group.
    // Both are how the list is SHOWN, so neither touches the board or the tool.
    if (evt.target.closest('[data-libview-toggle]')) {
      state.libView = state.libView === 'tiles' ? 'list' : 'tiles';
      saveLibraryView();
      return paintCards();
    }
    const libGroup = evt.target.closest('[data-libgroup]');
    if (libGroup) {
      const id = libGroup.dataset.libgroup;
      if (state.libCollapsed.has(id)) state.libCollapsed.delete(id);
      else state.libCollapsed.add(id);
      saveLibraryView();
      return paintLibrary();
    }

    // A device arms the same way a part does, and arms its BASE part with it,
    // so everything downstream that asks "what is armed" keeps working. Clearing
    // state.device is what un-arms it — see the part branch below.
    const device = evt.target.closest('[data-device]');
    if (device) {
      const d = getDevice(device.dataset.device);
      if (!d) return;
      state.device = d.id;
      state.part = d.base;
      // The device's own word on which way its pins run, if it has one.
      state.rot = defaultRotOf(getPart(d.base), d.pinsRun);
      buildPalette();
      paintLibrary();
      return setTool('place');
    }

    const part = evt.target.closest('[data-part]');
    if (part) {
      state.part = part.dataset.part;
      state.device = null;              // a generic part is not a device
      const chosen = getPart(state.part);
      // Arm the rotation the part asks for. A wire link declares 90 because a
      // link along a strip joins a segment to itself and does nothing.
      state.rot = defaultRotOf(chosen);
      buildPalette();
      // Point to point arms the WIRE tool: it is not placed, it is drawn between
      // two holes. That one field is what lets it sit in the same palette list.
      setTool(placesWith(chosen) === 'wire' ? 'wire' : 'place');
      return;
    }

    const tab = evt.target.closest('.tab');
    if (tab) return showTab(tab.dataset.tab);

    const netRow = evt.target.closest('[data-net]');
    if (netRow) {
      // The other direction, and it needs no separate code: the same selection
      // that the board sets, so the strips light and the row marks itself.
      const already = state.selection?.kind === 'net'
        && state.selection.ref === netRow.dataset.net;
      state.selection = already ? null : { kind: 'net', ref: netRow.dataset.net };
      return draw(already ? '' : `selected net ${netName(state.selection)}`);
    }

    if (evt.target.closest('#boardWrap')) onBoardClick(evt);
  });

  // The rubber band follows the cursor by moving ONE existing element. draw()
  // rebuilds the whole board as a string, and doing that per mousemove would
  // rebuild five hundred holes to move one line.
  $('#boardWrap').addEventListener('mousemove', (evt) => {
    if (!state.wireStart) return;
    const band = $('[data-kind="wire-band"]');
    if (!band) return;
    const pos = pointerHole(evt);
    if (!pos) return;
    const PITCH = 2.54;
    const w = state.project.board.cols * PITCH;
    band.setAttribute('x2', state.view === 'underside' ? w - pos.x : pos.x);
    band.setAttribute('y2', pos.y);
  });

  $('#rotate').addEventListener('click', () => {
    if (state.selection?.kind === 'part') {
      const list = state.project.placements;
      const i = list.findIndex((x) => x.ref === state.selection.ref);
      if (i < 0) return say('the selected part is gone');
      // rotatePlacement turns it about its own centre and returns a new object,
      // so the part stays where it sits instead of swinging around pin 1.
      list[i] = rotatePlacement(list[i], getPart);
      // Its cuts follow it, because they are derived rather than stored. This
      // used to merge a fresh set in and strand the old ones somewhere else.
      return commit(`${list[i].ref} rotated to ${list[i].rot}°`);
    }
    state.rot = (state.rot + 90) % 360;
    say(`nothing selected — the next part will be placed at ${state.rot}°`);
  });

  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);

  // One click, and the lit button says which side you are looking at without
  // being opened. `state.view` is unchanged, so nothing downstream moved.
  // `.viewbtn`, not `[data-view]`: the board's own SVG and every printed view
  // carry data-view too.
  for (const b of document.querySelectorAll('.viewbtn[data-view]')) {
    b.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.viewbtn[data-view]')) {
        other.classList.toggle('is-on', other === b);
      }
      // Print is a view of its own: the panel in the board's place, leaving
      // state.view — which side the board shows — exactly as it was.
      if (b.dataset.view === 'print') return showPrintView(true);
      showPrintView(false);
      state.view = b.dataset.view;
      draw(state.view === 'underside'
        ? 'bot — mirrored, this is what you solder'
        : 'top');
    });
  }

  // The way IN to the board list. It lived only inside a card that is collapsed
  // by default, under a header that said "25 × 20", so there was no way to pick
  // a board or start one without knowing where to look — which Peter reported as
  // "I cannot pick an existing board or create a new one".
  $('#boards').addEventListener('click', () => {
    state.openCard = state.openCard === 'board' ? null : 'board';
    paintCards();
    if (state.openCard === 'board') $('[data-cardbody="board"]')?.scrollIntoView({ block: 'nearest' });
  });

  // ------------------------------------------------- the component editor
  $('#components').addEventListener('click', () => { openComponents(); });
  $('#devBack').addEventListener('click', closeComponents);
  $('#devNew').addEventListener('click', newDevice);
  $('#devSave').addEventListener('click', () => { saveDevice(); });
  $('#devRevert').addEventListener('click', () => { revertDevice(); });
  $('#devList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-device]');
    if (row) chooseDevice(row.dataset.device);
  });
  $('#devSearch').addEventListener('input', paintDeviceList);

  // FROM THE TABLE TO THE DRAWING: focus a pin name and its pad lights.
  $('#devEdit').addEventListener('focusin', (e) => {
    const row = e.target.closest('[data-pin-row]');
    if (row) lightPin(Number(row.dataset.pinRow));
  });
  // AND FROM THE DRAWING TO THE TABLE: click a pad and its name takes focus.
  $('#devDrawing').addEventListener('click', (e) => {
    const badge = e.target.closest('[data-pin-badge]');
    if (!badge) return;
    const n = Number(badge.dataset.pinBadge);
    lightPin(n);
    $(`#devEdit [data-pin-index="${n - 1}"]`)?.focus();
  });
  // The preview follows what is typed, so a wrong span or footprint shows
  // itself before it is saved rather than after.
  $('#devEdit').addEventListener('input', () => {
    devEditing = readDeviceForm();
    paintDevicePreview();
  });
  $('#devEdit').addEventListener('change', (e) => {
    devEditing = readDeviceForm();
    // A different footprint has a different number of pins, so the name list
    // has to be rebuilt rather than left the wrong length.
    if (e.target.dataset.field === 'base' || e.target.dataset.field === 'span'
      || e.target.dataset.field === 'width') paintDeviceEditor(!$('#devRevert').hidden ? false : null);
    else paintDevicePreview();
  });
  // Pins run, and the side it mounts on: each stored only when it differs from
  // the footprint, so correcting a footprint corrects the devices built on it.
  $('#devEdit').addEventListener('click', (e) => {
    const run = e.target.closest('[data-pinsrun]');
    const side = e.target.closest('[data-devside]');
    if (!run && !side) return;
    devEditing = readDeviceForm();
    const base = getPart(devEditing.base);
    if (run) {
      if (run.dataset.pinsrun === base?.pinsRun) delete devEditing.pinsRun;
      else devEditing.pinsRun = run.dataset.pinsrun;
    } else if (side.dataset.devside === sideOf(base)) delete devEditing.side;
    else devEditing.side = side.dataset.devside;
    paintDeviceEditor(!$('#devRevert').hidden ? false : null);
  });

  // THE MORE MENU. Positioned FIXED from its button — the bar scrolls sideways
  // and clips anything absolutely placed inside it — and closed by a choice, by
  // Escape, or by a click anywhere else. Its items keep their own handlers,
  // below; this only opens and closes it. See docs/specs/toolbar-fits.md.
  const moreBtn = $('#more');
  const moreMenu = $('#moreMenu');
  const setMore = (open) => {
    moreMenu.hidden = !open;
    moreBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const r = moreBtn.getBoundingClientRect();
    moreMenu.style.top = `${Math.round(r.bottom + 4)}px`;
    moreMenu.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  };
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMore(moreMenu.hidden);
  });
  // A choice closes it after its own handler has run.
  moreMenu.addEventListener('click', () => setMore(false));
  document.addEventListener('click', (e) => {
    if (!moreMenu.hidden && !moreMenu.contains(e.target) && e.target !== moreBtn) setMore(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !moreMenu.hidden) setMore(false);
  });

  $('#theme').addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = state.theme;
    draw('');
    // The Library's footprints are drawn in a theme too; without this they
    // kept the old board colours on the new panel.
    paintCards();
  });

  $('#save').addEventListener('click', () => {
    persist();
    const blob = new Blob([JSON.stringify(state.project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.project.name || 'board'}.stripex.json`;
    a.click();
    say('saved to this browser, and downloaded');
  });

  $('#load').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const loaded = JSON.parse(await file.text());
        const problems = validateProject(loaded);
        if (problems.length) return say(`rejected: ${problems[0].message}`);
        // Loading stays UNDOABLE, as it was: commit pushes the board that was
        // on screen. Opening the wrong file must not be the one action with no
        // way back.
        state.project = loaded;
        history.commit(state.project);
        state.selection = null;
        persist();
        draw(`loaded ${file.name}`);
      } catch (e) {
        say(`could not read that file: ${e.message}`);
      }
    });
    input.click();
  });

  $('#restore').addEventListener('click', () => {
    const hist = readHistory(localStorage);
    if (!hist.length) return say('no snapshots yet — one is kept on every edit');
    // Listed by time and by how many parts each held, so "the one before it went
    // wrong" is findable by looking rather than by counting clicks.
    const lines = hist.map((h, i) => {
      const d = describe(h);
      return `${i + 1}. ${new Date(d.when).toLocaleTimeString()} — ${d.parts} parts, `
        + `${d.wires} wires, ${d.cuts} cuts`;
    });
    const pick = window.prompt(
      `Restore which snapshot? The current board is snapshotted first, so this `
      + `can be undone.\n\n${lines.join('\n')}`, '1');
    const n = Number(pick);
    if (!Number.isInteger(n) || n < 1 || n > hist.length) return say('nothing restored');
    // Snapshot what is on screen BEFORE replacing it, or restoring would be the
    // one action with no way back.
    pushSnapshot(localStorage, state.project);
    state.project = hist[n - 1].project;
    history.commit(state.project);
    state.selection = null;
    inspectorShape = null;
    persist();
    draw(`restored the snapshot from ${new Date(hist[n - 1].at).toLocaleTimeString()}`);
  });

  $('#export').addEventListener('click', () => {
    const svg = renderBoard(state.project, { view: state.view, theme: state.theme });
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.project.name || 'board'}-${state.view}.svg`;
    a.click();
    say(`exported the ${state.view} view`);
  });

  // ------------------------------------------------------------ print view
  // Choices in the panel. Attached once; the panel is not rebuilt, only its
  // lit states and its preview are (see the Layers card for why that matters).
  $('#printView').addEventListener('click', (e) => {
    const b = e.target.closest('[data-print-colour], [data-print-sides], [data-print-size]');
    if (!b) return;
    if (b.dataset.printColour) printPrefs.colour = b.dataset.printColour;
    if (b.dataset.printSides) printPrefs.sides = b.dataset.printSides;
    if (b.dataset.printSize) printPrefs.size = b.dataset.printSize;
    savePrintPrefs();
    paintPrintView();
  });
  $('#printView').addEventListener('change', (e) => {
    const { printLayer, printTable } = e.target.dataset;
    if (printLayer) printPrefs.layers[printLayer] = e.target.checked;
    else if (printTable) printPrefs.tables[printTable] = e.target.checked;
    else return;
    savePrintPrefs();
    paintPrintView();
  });
  $('#pvPrint').addEventListener('click', () => {
    // The very sheet the preview shows, not a second build of it.
    const { html, mono } = printSheetHtml();
    const sheet = $('#printSheet');
    sheet.innerHTML = html;
    sheet.classList.toggle('is-mono', mono);
    window.print();
  });

  document.addEventListener('keydown', (e) => {
    // Undo and redo are checked FIRST, and against a narrower guard: a field may
    // keep Ctrl+Z only when it has an undo of its own. The blanket
    // `input, select, textarea` guard below let the View dropdown swallow it and
    // offer nothing in return.
    const history_ = historyActionForKey(e);
    if (history_ && !ownsUndo(e.target)) {
      e.preventDefault();
      return history_ === 'redo' ? redo() : undo();
    }

    if (e.target.matches('input, select, textarea')) return;
    // Tool keys act on a board you can see. In the Print view you cannot.
    if (state.printing) return;
    if (e.key === 'Escape') {
      state.selection = null;
      // Escape means "stop what I am doing", and the armed tool is part of what
      // you are doing: cancelling a half-drawn wire should not leave the next
      // click starting another one. setTool clears the wire start and the move
      // handle on its way.
      setTool(TOOL_AFTER_ESCAPE);
      return draw('cancelled');
    }
    if (e.key.toLowerCase() === 'r') return $('#rotate').click();
    const t = toolForKey(e.key);
    if (t) {
      // Backspace navigates back in some browsers, and Delete can scroll.
      if (e.key === 'Delete' || e.key === 'Backspace') e.preventDefault();
      setTool(t);
    }
  });

  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  if (prefersDark) {
    state.theme = 'dark';
    document.documentElement.dataset.theme = 'dark';
  }

  draw('');

  // Say what was repaired, in words, at the top of the window. Every one of
  // these was previously a reason to throw the whole board away.
  if (loadRepairs.length) {
    banner(`${loadRepairs.length} thing${loadRepairs.length === 1 ? '' : 's'} in the `
      + 'stored board could not be opened and were left out. The rest is intact. '
      + loadRepairs.map((r) => r.message).join(' · '), 'error');
  }

  // The board lives on the server now. This runs after the first draw on
  // purpose: the editor is usable in the time the fetch takes, and it is still
  // usable if the fetch never answers.
  connectBoards();
}

// Find out what is on the server and open the right thing — without ever losing
// what is in this browser.
//
// THE MIGRATION IS THE POINT. There is a board in localStorage right now with
// twelve net names on it. "Storage moved to the server" must not mean "your
// board is gone", which is the failure this project has already had once.
// THE FEED. The file is the board; this is how the screen learns it changed.
//
// Peter: "the entire board should be a ws feed, so that changes that are made to
// the config file are updated immediately in the dashboard. that system of
// receovered files etc hacks is very convoluted and confusing."
//
// He was right, and the convolution was the workaround: four bugs this session
// came from nothing telling the browser the file had moved, and every attempt to
// guess it afterwards was wrong. Two of them cost him work.
let liveSocket = null;
function connectLive() {
  if (liveSocket) return;
  let url;
  try {
    url = new URL('/api/live', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  } catch { return; }

  let ws;
  try { ws = new WebSocket(url.toString()); } catch { return; }
  liveSocket = ws;

  ws.addEventListener('message', (evt) => {
    let msg = null;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.type === 'boards' || msg.type === 'hello') {
      state.boards = msg.boards ?? state.boards;
      paintCards();
      return;
    }
    // OUR BOARD WAS RENAMED ELSEWHERE. Follow it: the new slug, the new name
    // and the version the rename wrote. Staying on the old slug made every save
    // after it fail with "there is no board called …" — and before the version
    // guard, it recreated the board under its old name. The name is taken too,
    // or the next save would write the old one back. See rename-while-open.md.
    if (msg.type === 'renamed' && msg.from === state.slug) {
      state.slug = msg.to;
      state.version = msg.version;
      state.project = { ...state.project, name: msg.name };
      try { localStorage.setItem(OPEN_KEY, msg.to); } catch { /* a bookmark */ }
      paintCards();
      say(`this board was renamed to ${msg.name}`);
      // A save that failed because the board "did not exist" goes again, now
      // aimed at where it is.
      if (state.serverError) {
        state.serverError = null;
        for (const el of document.querySelectorAll('.banner')) {
          if (/NOT SAVED/.test(el.textContent)) el.remove();
        }
      }
      scheduleSave();
      return;
    }
    if (msg.type !== 'board' || msg.slug !== state.slug) return;
    applyFromFeed(msg);
  });

  // A dropped feed is not a broken editor: it still draws, still saves, and
  // tries again. Saying nothing and quietly going stale is what this replaces.
  const retry = () => {
    liveSocket = null;
    setTimeout(connectLive, 2000);
  };
  ws.addEventListener('close', retry);
  ws.addEventListener('error', () => { try { ws.close(); } catch { retry(); } });
}

// A board has arrived. Apply it when the editor is idle; offer it when it is
// not — only the person knows whether their half-drawn wire matters more than
// what arrived, and no heuristic can be told that.
function applyFromFeed(msg) {
  if (msg.version === state.version) return;      // our own save coming back
  const busy = state.wireStart || state.moveAnchor;
  if (busy) {
    state.incoming = msg;
    banner('This board changed on the server while you were mid-action. '
      + 'Finish or press Escape, then it will be applied.', 'warn');
    return;
  }
  const { project, repairs } = loadProject(JSON.stringify(msg.project));
  if (!project) return;
  loadRepairs = repairs;
  state.project = project;
  state.version = msg.version;
  state.selection = null;
  history.reset(state.project);
  persistDraftOnly();
  syncBoardSize();
  paintCards();
  draw('updated from the server');
}

async function connectBoards() {
  try {
    // THE CATALOGUE FIRST, before a board is drawn. A board may hold a device
    // Peter defined, and the palette lists devices — both need the stored set
    // installed over the built-ins, or a component he added would be missing
    // from his own editor.
    try { installDevices(await fetchStoredDevices()); }
    catch { /* the built-ins stand; the server being down is reported below */ }
    await decideWhichBoard();
    connectLive();
  } finally {
    // Saving is allowed from here and not before.
    //
    // AND OPENING A BOARD IS NOT AN EDIT. This used to end with an
    // unconditional scheduleSave(), so every page load pushed this browser's
    // copy to the server — and a change made to the file by anyone else was
    // destroyed by the next refresh, with nothing typed. It ate a fix of mine
    // while I was making it. Peter: "even if I make no changes and refresh the
    // page, it seems it saves it overwriting any beckend changes."
    //
    // Only an edit that actually happened during the boot window is flushed —
    // plus the deferred save that openBoard asks for when it kept unsaved work,
    // which is the same mechanism and is why that path no longer has to ask the
    // user to "make any edit to save yours".
    state.ready = true;
    if (savePending && !state.conflict) scheduleSave();
    savePending = false;
  }
}

async function decideWhichBoard() {
  let boardList;
  try {
    boardList = await refreshBoards();
  } catch (e) {
    return banner(`The board server is not answering (${e.message}). You can keep `
      + 'drawing — this board is kept in your browser — but it is not being shared.', 'warn');
  }

  const wanted = localStorage.getItem(OPEN_KEY);
  if (wanted && boardList.some((b) => b.slug === wanted)) {
    // THE SERVER'S COPY. There is no other copy to weigh it against any more,
    // which is the whole point: every reconciliation rule written here — compare
    // by bytes, compare by dirty flag, keep the draft, ask the user — existed
    // only because the browser held a second board, and each one was wrong in a
    // way that cost Peter something.
    await openBoard(wanted);
    return;
  }

  // NOTHING TO REOPEN. There used to be a rescue here: whatever the browser had
  // cached got posted to the server, under its own name or under
  // `recovered <date>` if it had none.
  //
  // THAT IS WHERE THE NAME CAME FROM. "recovered 2026-08-30" was never a board
  // Peter named — it was a label this branch invented for a draft it was
  // rescuing, and it then haunted his board for two days. With no cache there is
  // no orphaned work to rescue and no need to invent a name for it.

  if (boardList.length) {
    await openBoard(boardList[0].slug);
    return;
  }
  paintCards();
  banner('No boards on the server yet. Name this one in the Board card and it will '
    + 'be saved as a file.', 'warn');
}

boot();
