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
import { TABS, DEFAULT_TAB, focusTabFor, bodyId } from '/src/render/panels.js';
import { partList, getPart } from '/src/parts/library.js';

const $ = (sel) => document.querySelector(sel);
const STORE_KEY = 'stripex.project';
const LAYER_KEY = 'stripex.layers';

// Order and wording of the layer list. The swatch is the colour that layer
// actually paints, so the list reads as the drawing rather than as a glossary.
const LAYER_ROWS = [
  ['components', 'Components', '#3d4450'],
  ['links', 'Wire links', '#8e9099'],
  ['wires', 'Pen wires', '#1f6feb'],
  ['breaks', 'Track breaks', '#8a7a5c'],
  ['copper', 'Copper strips', '#b87333'],
  ['holes', 'Holes', '#3a3226'],
  ['labels', 'Refs and values', '#241f18'],
  ['drc', 'Check markers', '#d1242f'],
];

const state = {
  project: load() ?? makeProject({ cols: 25, rows: 20 }),
  tool: 'select',
  part: 'res-axial',
  span: 4,
  width: 3,
  cut: 'gap',
  rot: 0,
  view: 'top',
  theme: 'light',
  selection: null,
  highlightNet: null,
  wireStart: null,
  drag: null,
  layers: loadLayers(),
  undo: [],
  redo: [],
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
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const problems = validateProject(p);
    if (problems.length) {
      console.warn('stored project rejected:', problems);
      return null;
    }
    return p;
  } catch (e) {
    console.warn('stored project unreadable:', e);
    return null;
  }
}

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.project)); } catch { /* full */ }
}

// ------------------------------------------------------------------------ undo
//
// Snapshots, not command/inverse pairs. The project is small and JSON-cloneable,
// so a snapshot stack is correct by construction; an inverse-command stack would
// need every tool to get its own undo right, and one of them eventually would not.

function commit(label) {
  state.undo.push(JSON.stringify(state.project));
  if (state.undo.length > 200) state.undo.shift();
  state.redo.length = 0;
  persist();
  draw(label);
}

function undo() {
  if (!state.undo.length) return say('nothing to undo');
  state.redo.push(JSON.stringify(state.project));
  state.project = JSON.parse(state.undo.pop());
  state.selection = null;
  persist();
  draw('undone');
}

function redo() {
  if (!state.redo.length) return say('nothing to redo');
  state.undo.push(JSON.stringify(state.project));
  state.project = JSON.parse(state.redo.pop());
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
    highlightNet: state.highlightNet,
    findings: lastFindings,
    selection: state.selection,
    layers: state.layers,
  });

  paintFindings(lastFindings);
  paintNets();
  paintRunList();
  paintInspector();
  paintLayers();
  markSelectedRows();
  focusOnSelectionChange();
  if (message) say(message);
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
}

function paintLayers() {
  const hidden = LAYER_ROWS.filter(([k]) => !state.layers[k]).length;
  $('#layers').innerHTML = LAYER_ROWS.map(([key, label, colour]) => `
    <label class="${state.layers[key] ? '' : 'is-off'}">
      <input type="checkbox" data-layer="${key}" ${state.layers[key] ? 'checked' : ''}>
      <span class="swatch" style="background:${colour}"></span>
      <span>${label}</span>
    </label>`).join('');
  $('#layersAll').hidden = hidden === 0;
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
  const { nets } = netsFor(state.project);
  $('#tab-nets').innerHTML = nets.map((netObj) => `
    <div class="row" data-net="${netObj.id}">
      <span class="ref mono">${netObj.id}</span>
      <span class="msg">${netObj.segments.length} segment${netObj.segments.length === 1 ? '' : 's'},
        ${netObj.pins.length} connection${netObj.pins.length === 1 ? '' : 's'}</span>
    </div>`).join('') || '<p class="empty">No nets.</p>';
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

function paintInspector() {
  const el = $('#tab-inspect');
  const sel = state.selection;
  if (!sel) { el.innerHTML = '<p class="empty">Nothing selected.</p>'; return; }

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
    const w = state.project.wires.find((x) => x.ref === sel.ref);
    if (!w) { el.innerHTML = '<p class="empty">Gone.</p>'; return; }
    el.innerHTML = `
      <div class="field"><span>Wire</span><span class="mono">${w.ref}</span></div>
      <div class="field"><span>From</span><span class="mono">${w.from.col},${w.from.row}</span></div>
      <div class="field"><span>To</span><span class="mono">${w.to.col},${w.to.row}</span></div>`;
    return;
  }

  const pl = state.project.placements.find((x) => x.ref === sel.ref);
  if (!pl) { el.innerHTML = '<p class="empty">Gone.</p>'; return; }
  const part = getPart(pl.part);
  el.innerHTML = `
    <div class="field"><span>Ref</span><span class="mono">${pl.ref}</span></div>
    <div class="field"><span>Part</span><span>${part.name}</span></div>
    <div class="field"><span>At</span><span class="mono">${pl.at.col},${pl.at.row}</span></div>
    <div class="field"><span>Rotation</span><span class="mono">${pl.rot ?? 0}°</span></div>
    ${part.parametric ? `<div class="field"><span>Span</span><span class="mono">${pl.span}</span></div>` : ''}
    <div class="field"><span>Value</span>
      <input id="valueEdit" value="${escapeHtml(pl.value ?? '')}" style="width:110px"></div>`;

  $('#valueEdit')?.addEventListener('change', (e) => {
    pl.value = e.target.value;
    commit(`${pl.ref} = ${e.target.value}`);
  });
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
      const pl = {
        ref: nextPartRef(p, state.part),
        part: state.part,
        at: { col: hole.col, row: hole.row },
        rot: state.rot,
      };
      if (part.parametric) pl.span = state.span;
      if (part.defaultWidth != null) pl.width = state.width;
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
        return say(`wire from (${hole.col},${hole.row}) — click the other end`);
      }
      if (state.wireStart.col === hole.col && state.wireStart.row === hole.row) {
        state.wireStart = null;
        return say('cancelled — a wire needs two different holes');
      }
      const wire = { ref: nextWireRef(p), from: state.wireStart, to: hole };
      p.wires.push(wire);
      state.wireStart = null;
      state.selection = { kind: 'wire', ref: wire.ref };
      commit(`${wire.ref}: (${wire.from.col},${wire.from.row}) → (${wire.to.col},${wire.to.row})`);
      return;
    }

    case 'delete': {
      const partEl = evt.target.closest('[data-kind="part"]');
      const wireEl = evt.target.closest('[data-kind="wire"], [data-kind="wire-label"]');
      const breakEl = evt.target.closest('[data-kind="break"]');
      if (partEl) {
        const ref = partEl.getAttribute('data-ref');
        p.placements = p.placements.filter((x) => x.ref !== ref);
        state.selection = null;
        return commit(`deleted ${ref}`);
      }
      if (wireEl) {
        const ref = wireEl.getAttribute('data-ref');
        p.wires = p.wires.filter((x) => x.ref !== ref);
        state.selection = null;
        return commit(`deleted ${ref}`);
      }
      if (breakEl) {
        const [row, x] = breakEl.getAttribute('data-break').split(',').map(Number);
        const owner = ownerOf(p, row, x);
        if (owner) {
          return say(`that cut belongs to ${owner} — move or delete ${owner} instead`);
        }
        p.breaks = p.breaks.filter((bk) => !(bk.row === row && bk.x === x));
        return commit(`restored the copper at row ${row}`);
      }
      return say('nothing there to delete');
    }

    default: {
      const partEl = evt.target.closest('[data-kind="part"]');
      const wireEl = evt.target.closest('[data-kind="wire"], [data-kind="wire-label"]');
      const breakEl = evt.target.closest('[data-kind="break"]');
      if (partEl) state.selection = { kind: 'part', ref: partEl.getAttribute('data-ref') };
      else if (wireEl) state.selection = { kind: 'wire', ref: wireEl.getAttribute('data-ref') };
      else if (breakEl) {
        state.selection = { kind: 'break', ref: breakEl.getAttribute('data-break') };
      } else state.selection = null;

      const copper = evt.target.closest('[data-kind="copper"]');
      if (copper && !partEl && !wireEl && !breakEl) {
        const { segmentNet } = netsFor(p);
        const netId = segmentNet[copper.getAttribute('data-seg')];
        state.highlightNet = state.highlightNet === netId ? null : netId;
      }
      const what = { part: 'part', wire: 'wire', break: 'break at' };
      draw(state.selection
        ? `selected ${what[state.selection.kind]} ${state.selection.ref}`
        : '');
    }
  }
}

// -------------------------------------------------------------------- palette

function buildPalette() {
  const parts = partList();
  $('#palette').innerHTML = parts.map((p) => `
    <button data-part="${p.id}" class="${p.id === state.part ? 'is-on' : ''}">
      ${p.name}${p.kind === 'link' ? '<span class="kind">link</span>' : ''}
    </button>`).join('');
  syncSpan();
}

function syncSpan() {
  const part = getPart(state.part);
  const box = $('#span');
  box.disabled = !part.parametric;
  box.min = part.minSpan ?? 1;
  if (part.parametric) {
    state.span = Math.max(state.span, part.minSpan ?? 1);
    box.value = state.span;
  }
  $('#spanLabel').textContent = part.parametric ? (part.spanLabel ?? '') : 'fixed';

  // A DIL has two dimensions; most parts have one. Show the second only when it
  // means something.
  const hasWidth = part.defaultWidth != null;
  $('#widthRow').hidden = !hasWidth;
  if (hasWidth) {
    state.width = Math.max(state.width, part.minWidth ?? 2);
    $('#width').min = part.minWidth ?? 2;
    $('#width').value = state.width;
    $('#widthLabel').textContent = part.widthLabel ?? '';
  }

  const hints = [];
  hints.push(part.kind === 'link'
    ? 'A link is zero-ohm: it joins the strips it bridges into one net.'
    : 'A component sits between nets — it never joins two strips.');
  if ((part.side ?? 'top') === 'copper') {
    hints.push('Soldered to the copper underneath, straddling a cut — the hole stays free.');
  }
  if (part.requiresBreak) {
    hints.push('Placing it cuts the strips it needs.');
  }
  $('#paletteHint').textContent = hints.join(' ');
}

// ---------------------------------------------------------------------- wiring

function setTool(tool) {
  state.tool = tool;
  state.wireStart = null;
  for (const b of document.querySelectorAll('.tool')) {
    b.classList.toggle('is-on', b.dataset.tool === tool);
  }
  // Set here, the one place the armed tool changes, so the cursor cannot drift
  // out of step with the button the toolbar shows as lit. Board only — a
  // crosshair over the parts list would be nonsense.
  $('#boardWrap').style.cursor = cursorFor(tool);
  const help = {
    select: 'Click a part or wire to select it; click a strip to highlight its net.',
    place: 'Click a hole to drop the palette part. R rotates.',
    break: state.cut === 'hole'
      ? 'Click a hole to spot-face it. The hole itself goes dead. Click again to restore it.'
      : 'Click between two holes to cut the strip there. Click again to restore it.',
    wire: 'Click one hole, then another. The wire gets the next free ref.',
    delete: 'Click a part, wire or break to remove it.',
  };
  say(help[tool]);
}

function boot() {
  buildTabs();
  buildPalette();
  setTool('select');

  document.addEventListener('click', (evt) => {
    const tool = evt.target.closest('.tool');
    if (tool) return setTool(tool.dataset.tool);

    const part = evt.target.closest('[data-part]');
    if (part) {
      state.part = part.dataset.part;
      buildPalette();
      setTool('place');
      return;
    }

    const tab = evt.target.closest('.tab');
    if (tab) return showTab(tab.dataset.tab);

    const netRow = evt.target.closest('[data-net]');
    if (netRow) {
      state.highlightNet = state.highlightNet === netRow.dataset.net ? null : netRow.dataset.net;
      return draw('');
    }

    if (evt.target.closest('#boardWrap')) onBoardClick(evt);
  });

  $('#layers').addEventListener('change', (e) => {
    const key = e.target.dataset.layer;
    if (!key) return;
    state.layers[key] = e.target.checked;
    try { localStorage.setItem(LAYER_KEY, JSON.stringify(state.layers)); } catch { /* full */ }
    const off = LAYER_ROWS.filter(([k]) => !state.layers[k]).map(([, l]) => l.toLowerCase());
    draw(off.length ? `hidden: ${off.join(', ')}` : 'all layers shown');
  });

  $('#layersAll').addEventListener('click', () => {
    state.layers = { ...DEFAULT_LAYERS };
    try { localStorage.setItem(LAYER_KEY, JSON.stringify(state.layers)); } catch { /* full */ }
    draw('all layers shown');
  });

  $('#span').addEventListener('change', (e) => {
    state.span = Math.max(1, Number(e.target.value) || 1);
    syncSpan();
  });

  $('#width').addEventListener('change', (e) => {
    state.width = Math.max(2, Number(e.target.value) || 3);
    syncSpan();
  });

  for (const radio of document.querySelectorAll('input[name="cut"]')) {
    radio.addEventListener('change', (e) => {
      state.cut = e.target.value;
      setTool('break');
    });
  }

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

  $('#view').addEventListener('change', (e) => {
    state.view = e.target.value;
    draw(state.view === 'underside' ? 'underside — mirrored, this is what you solder' : 'top');
  });

  for (const id of ['#cols', '#rows']) {
    $(id).addEventListener('change', () => {
      state.project.board.cols = Math.max(4, Number($('#cols').value) || 25);
      state.project.board.rows = Math.max(2, Number($('#rows').value) || 20);
      state.project.breaks = state.project.breaks.filter(
        (b) => b.row < state.project.board.rows && b.x <= state.project.board.cols - 2,
      );
      commit(`board is ${state.project.board.cols} × ${state.project.board.rows}`);
    });
  }

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
        state.undo.push(JSON.stringify(state.project));
        state.project = loaded;
        state.selection = null;
        $('#cols').value = loaded.board.cols;
        $('#rows').value = loaded.board.rows;
        persist();
        draw(`loaded ${file.name}`);
      } catch (e) {
        say(`could not read that file: ${e.message}`);
      }
    });
    input.click();
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
    if (e.target.matches('input, select, textarea')) return;
    const keys = { v: 'select', p: 'place', b: 'break', w: 'wire', x: 'delete' };
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (e.key === 'Escape') {
      state.wireStart = null;
      state.selection = null;
      return draw('cancelled');
    }
    if (e.key.toLowerCase() === 'r') return $('#rotate').click();
    const t = keys[e.key.toLowerCase()];
    if (t) setTool(t);
  });

  $('#cols').value = state.project.board.cols;
  $('#rows').value = state.project.board.rows;

  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  if (prefersDark) {
    state.theme = 'dark';
    document.documentElement.dataset.theme = 'dark';
  }

  draw('');
  document.body.insertAdjacentHTML('afterbegin',
    '<p class="banner">Project storage is not built yet — this board lives in '
    + 'this browser only. Use Save to download a copy.</p>');
}

boot();
