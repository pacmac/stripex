// The editor: state, tools, undo, event delegation.
//
// It owns NO drawing. Every pixel comes from renderBoard() in src/render/svg.js,
// which node also imports, so what the tests check and what the browser shows
// cannot drift apart. Hit-testing reads data-* attributes off event.target
// rather than recomputing layout — one description of where things are.

import { renderBoard, findingsFor, netsFor, runList, DEFAULT_LAYERS } from '/src/render/svg.js';
import { makeProject, validateProject, nextWireRef, nextPartRef } from '/src/model/board.js';
import { rotatePlacement } from '/src/model/rotate.js';
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
import { movePlacementByPin, pinLocation } from '/src/model/move.js';
import {
  wireColour, silkOf, linkColour, wireLengthHoles,
  COLOUR_CODE, PALETTE_16,
} from '/src/render/colours.js';
import { deviceList, getDevice, placementFor } from '/src/parts/devices.js';

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
  partList, getPart, defaultRotOf, placesWith, CATEGORIES, pinLabel,
} from '/src/parts/library.js';

const $ = (sel) => document.querySelector(sel);
const STORE_KEY = 'stripex.project';
// Which board on the server this browser had open. The board itself lives on the
// server now; this is only the bookmark.
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
  ['drc', 'Check markers', '#d1242f'],
];

const state = {
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

function load() {
  const { project, repairs } = loadProject(localStorage.getItem(STORE_KEY));
  loadRepairs = repairs;
  if (project) return project;

  // Nothing readable. Fall back to the newest snapshot BEFORE giving up — that
  // is what the history is for.
  const [snapshot] = readHistory(localStorage);
  if (snapshot?.project) {
    loadRepairs = [...repairs, {
      code: 'from-history',
      message: `the stored board could not be read, so the snapshot from `
        + `${new Date(snapshot.at).toLocaleString()} was opened instead`,
    }];
    return snapshot.project;
  }
  return null;
}

// Returns whether it actually wrote. The old version swallowed a quota error in
// an empty catch, so once storage filled every later edit was silently not
// saved and you found out on reload.
function persist() {
  let ok = true;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.project));
  } catch (e) {
    ok = false;
    banner(`NOT SAVED — browser storage is full (${e.name}). Use Save to `
      + 'download this board before doing anything else.', 'error');
  }
  // History second, and never at the board's expense: pushSnapshot drops its own
  // oldest entries until it fits rather than touching the board.
  try { pushSnapshot(localStorage, state.project); } catch { /* history is expendable */ }
  // And to the server, where the board actually lives. localStorage is now a
  // DRAFT CACHE: it survives the server being down, so you can keep drawing.
  scheduleSave();
  return ok;
}

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

// `keepDraft` is how the reload path says "there is work in this browser that
// the server has not got". See connectBoards.
async function openBoard(slug, { keepDraft = null } = {}) {
  const { ok, body } = await api(`/api/boards/${slug}`);
  if (!ok) return say(body?.error ?? 'could not open that board');

  // WORK IN THIS BROWSER IS NEVER SILENTLY REPLACED.
  //
  // This installed the server's copy and persisted it, so a draft that the
  // server had not got was destroyed on reload — which is what happened to
  // Peter: his saves had been refused as stale after the file changed under
  // him, his work was only in localStorage, and reloading threw it away.
  //
  // A difference is a QUESTION. The copy the user can see wins by default,
  // because it is the one they remember making, and the server's is offered.
  if (keepDraft) {
    state.slug = slug;
    state.version = body.version;
    state.conflict = body.project;
    state.selection = null;
    history.reset(state.project);
    localStorage.setItem(OPEN_KEY, slug);
    paintCards();
    draw('kept the work in this browser');
    banner('The copy of this board in your browser is NOT the one on the server, and '
      + 'yours is what you are looking at. Nothing has been overwritten. Make any edit '
      + 'to save yours over the server’s, or open the board again from the Board card '
      + 'to take the server’s and lose yours.', 'error');
    return;
  }

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
  persist();
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
  state.project.name = wanted;
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
  lastFindings = findingsFor(p);

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
  paintRunList();
  paintInspector();
  paintLayers();
  markSelectedRows();
  focusOnSelectionChange();
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
  body.addEventListener('change', (e) => {
    const key = e.target.dataset.layer;
    if (!key) return;
    state.layers[key] = e.target.checked;
    try { localStorage.setItem(LAYER_KEY, JSON.stringify(state.layers)); } catch { /* full */ }
    const off = LAYER_ROWS.filter(([k]) => !state.layers[k]).map(([, l]) => l.toLowerCase());
    draw(off.length ? `hidden: ${off.join(', ')}` : 'all layers shown');
  });
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

  const conflicts = netLabelProblems(state.project, segmentNet);
  const warn = conflicts.length
    ? `<p class="hint" style="color:var(--error)">${escapeHtml(conflicts[0].message)}</p>`
    : '';

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
  }).join('') || '<p class="empty">No nets.</p>');

  for (const input of $('#tab-nets').querySelectorAll('[data-netname]')) {
    input.addEventListener('change', (e) => {
      const [col, row] = e.target.dataset.netname.split(',').map(Number);
      const existing = effectiveBreaks(state.project) && labelAt(col, row);
      state.project = setNetLabel(state.project, { col, row },
        { ...existing, name: e.target.value.trim() });
      commit(e.target.value.trim() ? `net named ${e.target.value.trim()}` : 'net name cleared');
    });
  }
  for (const sw of $('#tab-nets').querySelectorAll('[data-netcolour]')) {
    sw.addEventListener('click', (e) => {
      const [col, row] = e.currentTarget.dataset.netcolour.split(',').map(Number);
      const existing = labelAt(col, row);
      state.project = setNetLabel(state.project, { col, row },
        { ...existing, colour: e.currentTarget.dataset.hex || undefined });
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
      state.project.breaks = state.project.breaks.filter(
        (b) => !(b.row === row && b.x === x),
      );
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
        const j = state.project.wires.findIndex((x) => x.ref === state.selection?.ref);
        if (j < 0) return;
        const { wire, error } = applyWireEdit(
          state.project.wires[j], e.currentTarget.dataset.wswatch,
          e.currentTarget.dataset.hex,
        );
        if (error) { $('#editError').textContent = error; return; }
        state.project.wires[j] = wire;
        inspectorShape = null;
        commit(`${wire.ref} ${e.currentTarget.dataset.wswatch} `
          + `${e.currentTarget.dataset.hex || 'default'}`);
      });
    }

    for (const input of el.querySelectorAll('[data-wedit]')) {
      input.addEventListener('change', (e) => {
        const field = e.target.dataset.wedit;
        // Same as for placements: read the current wire, not a captured copy.
        const j = state.project.wires.findIndex((x) => x.ref === state.selection?.ref);
        if (j < 0) return;
        const { wire, error } = applyWireEdit(state.project.wires[j], field, e.target.value);
        if (error) { syncInspectorValues(true); $('#editError').textContent = error; return; }
        state.project.wires[j] = wire;
        if (field === 'ref') state.selection = { kind: 'wire', ref: wire.ref };
        commit(`${wire.ref} ${field} = ${e.target.value}`);
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
    <div class="field"><span>Part</span><span>${escapeHtml(part.name)}</span></div>
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
    <div class="field"><span>Column</span>${num('col', pl.at.col, 'min="0"')}</div>
    <div class="field"><span>Row</span>${num('row', pl.at.row, 'min="0"')}</div>
    <p class="hint" id="editError"></p>`;

  // One commit per change event, not per keystroke, so an edit is one undo step.
  for (const sw of el.querySelectorAll('[data-swatch]')) {
    sw.addEventListener('click', (e) => {
      const field = e.currentTarget.dataset.swatch;
      const hex = e.currentTarget.dataset.hex;
      const i2 = state.project.placements.findIndex((x) => x.ref === state.selection?.ref);
      if (i2 < 0) return;
      const { placement, error } = applyPlacementEdit(
        state.project.placements[i2], getPart, field, hex,
      );
      if (error) { $('#editError').textContent = error; return; }
      state.project.placements[i2] = placement;
      inspectorShape = null;          // the swatch selection changed, so repaint
      commit(`${placement.ref} ${field} ${hex || 'default'}`);
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
      const i2 = state.project.placements.findIndex((x) => x.ref === state.selection?.ref);
      if (i2 < 0) return;
      const current = state.project.placements[i2];
      const { placement, error } = applyPlacementEdit(current, getPart, field, value);
      if (error) {
        // Put the rejected value back — including into the focused field, which
        // is the one that holds it — and leave the field itself alone so the
        // user can correct it without clicking back in.
        syncInspectorValues(true);
        $('#editError').textContent = error;
        return;
      }
      state.project.placements[i2] = placement;
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
      // A DEVICE BUILDS ITS OWN PLACEMENT, because its span, width, silk and pin
      // names are the device's and not the panel's. placementFor copies them on,
      // so the board that results owes the catalogue nothing.
      let pl;
      if (state.device) {
        pl = placementFor(state.device, { col: hole.col, row: hole.row }, state.rot,
          nextPartRef(p, getDevice(state.device).base));
        if (!pl) return say('that device is not in the catalogue');
      } else {
        pl = {
          ref: nextPartRef(p, state.part),
          part: state.part,
          at: { col: hole.col, row: hole.row },
          rot: state.rot,
        };
        if (part.parametric) pl.span = state.span;
        if (part.defaultWidth != null) pl.width = state.width;
      }
      p.placements.push(pl);
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
        p.breaks.splice(found, 1);
        return commit(state.cut === 'hole'
          ? `restored the copper at hole (${x},${row})`
          : `restored row ${row} between holes ${x} and ${x + 1}`);
      }
      p.breaks = p.breaks.filter((bk) => !(bk.row === row && bk.x === x));
      p.breaks.push({ row, x, at: state.cut });
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
      const wire = { ref: nextWireRef(p), from: state.wireStart, to: hole };
      p.wires.push(wire);
      state.wireStart = null;
      state.selection = { kind: 'wire', ref: wire.ref };
      commit(`${wire.ref}: (${wire.from.col},${wire.from.row}) → (${wire.to.col},${wire.to.row})`);
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

      const i = p.placements.findIndex((x) => x.ref === state.moveAnchor.ref);
      if (i < 0) { state.moveAnchor = null; return draw('that device is gone'); }
      const from = state.moveAnchor;
      p.placements[i] = movePlacementByPin(p.placements[i], getPart, from.pin, hole);
      state.moveAnchor = null;
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
        '[data-kind="wire-pad"], [data-kind="wire"], [data-kind="wire-label"]',
      );
      // break-hit is the invisible target painted above the parts, so a cut
      // under a component is reachable. It carries the same data-break, so it
      // is treated as the cut it stands for.
      const breakEl = evt.target.closest('[data-kind="break"], [data-kind="break-hit"]');
      if (partEl) {
        const ref = partEl.getAttribute('data-ref');
        p.placements = p.placements.filter((x) => x.ref !== ref);
        state.selection = null;
        return removed(`deleted ${ref}`);
      }
      if (wireEl) {
        const ref = wireEl.getAttribute('data-ref');
        p.wires = p.wires.filter((x) => x.ref !== ref);
        state.selection = null;
        return removed(`deleted ${ref}`);
      }
      if (breakEl) {
        const [row, x] = breakEl.getAttribute('data-break').split(',').map(Number);
        const owner = ownerOf(p, row, x);
        if (owner) {
          return say(`that cut belongs to ${owner} — move or delete ${owner} instead`);
        }
        p.breaks = p.breaks.filter((bk) => !(bk.row === row && bk.x === x));
        return removed(`restored the copper at row ${row}`);
      }
      return say('nothing there to delete');
    }

    default: {
      const partEl = evt.target.closest('[data-kind="part"]');
      // wire-pad first: with no line drawn, the pads ARE the wire on the board.
      const wireEl = evt.target.closest(
        '[data-kind="wire-pad"], [data-kind="wire"], [data-kind="wire-label"]',
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
      <button class="card-head" data-cardtoggle="${c.id}">
        <span class="card-icon">${c.icon}</span>
        <span class="card-title">${c.title}</span>
        <span class="card-sub" data-cardsub="${c.id}"></span>
        <span class="card-chev">▾</span>
      </button>
      <div class="card-body" data-cardbody="${c.id}" hidden></div>
    </section>`).join('');

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
  syncBoardSize();

  if (state.openCard === 'library') paintLibrary();
  if (state.openCard === 'layers') paintLayers();
  if (state.openCard === 'board') paintBoardCard();
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

  $('[data-cardbody="library"]').innerHTML = `
    <input id="libsearch" class="lib-search" placeholder="search parts"
      value="${escapeHtml(state.search)}">
    ${groups.map((g) => `
      <div class="lib-group">${escapeHtml(g.name)}</div>
      ${g.parts.map((p) => `
        <button ${p.isDevice ? `data-device="${p.id}"` : `data-part="${p.id}"`}
          class="${(p.isDevice ? p.id === state.device : p.id === state.part && !state.device)
            ? 'is-on' : ''}">
          ${escapeHtml(p.name)}${p.kind === 'link' ? '<span class="kind">link</span>' : ''}${
  p.unverifiedPins?.length ? '<span class="kind warn">?</span>' : ''}
        </button>${paramsHtml(p)}`).join('')}`).join('')
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
    const before = (p.placements?.length ?? 0) + (p.wires?.length ?? 0);
    if (sel.kind === 'part') p.placements = p.placements.filter((x) => x.ref !== sel.ref);
    else p.wires = p.wires.filter((x) => x.ref !== sel.ref);
    if ((p.placements.length + p.wires.length) === before) return false;   // nothing matched
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
  for (const b of document.querySelectorAll('.tool')) {
    const mine = b.dataset.tool === tool
      && (!b.dataset.cut || b.dataset.cut === state.cut);
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
      return setTool(tool.dataset.tool);
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
      state.rot = defaultRotOf(getPart(d.base));
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
  for (const b of document.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      for (const other of document.querySelectorAll('[data-view]')) {
        other.classList.toggle('is-on', other === b);
      }
      draw(state.view === 'underside'
        ? 'underside — mirrored, this is what you solder'
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

  $('#theme').addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = state.theme;
    draw('');
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
async function connectBoards() {
  try {
    await decideWhichBoard();
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
    // Only an edit that actually happened during the boot window is flushed,
    // and not even that when a differing draft was kept: there the banner says
    // "make any edit to save yours", and the user's next edit is what does it.
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
    // Is the draft in this browser the same board the server has? Compared by
    // CONTENT, because that is the question — not by version, which the browser
    // may never have seen, and not by timestamp, which neither side keeps.
    const { ok: readOk, body } = await api(`/api/boards/${wanted}`);
    const differs = readOk && JSON.stringify(body.project) !== JSON.stringify(state.project);
    await openBoard(wanted, { keepDraft: differs ? state.project : null });
    return;
  }

  // Nothing to reopen. Whatever is on screen came from localStorage, so put it
  // somewhere it can be shared — under its own name if it has one, and under a
  // plain one if it does not.
  const hasWork = (state.project.placements?.length ?? 0) > 0
    || (state.project.wires?.length ?? 0) > 0
    || (state.project.breaks?.length ?? 0) > 0;
  if (hasWork) {
    const name = state.project.name && state.project.name !== 'untitled'
      ? state.project.name
      : `recovered ${new Date().toISOString().slice(0, 10)}`;
    await newBoard(name, { ...state.project, name });
    banner(`Your board is now on the server as boards/${state.slug}.json, so it can be `
      + 'shared and edited. It was only in this browser until now.', 'ok');
    return;
  }

  if (boardList.length) {
    await openBoard(boardList[0].slug);
    return;
  }
  paintCards();
  banner('No boards on the server yet. Name this one in the Board card and it will '
    + 'be saved as a file.', 'warn');
}

boot();
