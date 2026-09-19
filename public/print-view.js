// THE PRINT VIEW: the panel in the board's place, and the sheet it prints.
//
// Peter: "rename Underside -> "Bot", add another button print ... the layer
// selection and print settings should persist so that each time I print I wont
// have to re-select everything. this panel should have a print button, probably
// top right". See docs/specs/print-view.md and docs/specs/build-sheet-design.md.
//
// Print is a VIEW. Its choices — the page, which layers, which tables — are a
// preference of whoever is printing, kept like the layers are, and no board
// data goes near the browser store.
//
// Its own module because it is separable: it reads the project and writes the
// panel, and shares nothing with the editor's tools but the four helpers passed
// to initPrintView. See docs/specs/architecture-for-netlist.md for why app.js
// is being taken apart at all.

import { renderBoard, DEFAULT_LAYERS } from '/src/render/svg.js';
import { printLayout, viewBoxSize, cutRows, wireRows, tableSizeMm, tablesBlockMm } from '/src/render/print.js';
import { bomFor } from '/src/model/views.js';

const PRINT_KEY = 'stripex.print';
const PRINT_SIDES = ['top', 'underside'];

// Filled in by initPrintView: the editor's state object, its $ and escapeHtml,
// and the layer list the panel offers (every layer except the check markers).
let state = null;
let $ = null;
let escapeHtml = null;
let PRINT_LAYERS = [];

export let printPrefs = null;

// LAYERS PER SIDE. Peter: "I need to set what layers are visible for top/bot
// seperatly (i.e 2 cols of checkboxes, 1 for top and 1 for bottome." So the
// print layers are { top: {...}, underside: {...} }. A preference saved before
// that — one flat set — applies to both, so nobody loses what they had chosen.
function readPrefs() {
  const screen = Object.fromEntries(PRINT_LAYERS.map(([k]) => [k, state.layers?.[k] !== false]));
  const base = {
    colour: 'colour',
    sides: 'both',
    size: 'actual',
    layers: { top: { ...screen }, underside: { ...screen } },
    tables: { bom: false, cuts: false, wires: false },
  };
  try {
    const raw = JSON.parse(localStorage.getItem(PRINT_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const saved = raw.layers ?? {};
      const perSide = saved.top || saved.underside;
      return {
        ...base, ...raw,
        layers: {
          top: { ...base.layers.top, ...(perSide ? saved.top ?? {} : saved) },
          underside: { ...base.layers.underside, ...(perSide ? saved.underside ?? {} : saved) },
        },
        tables: { ...base.tables, ...(raw.tables ?? {}) },
      };
    }
  } catch { /* a preference, not a record */ }
  return base;
}

export function savePrintPrefs() {
  try { localStorage.setItem(PRINT_KEY, JSON.stringify(printPrefs)); } catch { /* a preference */ }
}

// The drawing for paper: the print layers, never the check markers, never a
// selection or a lit net — those belong to editing, not to a build sheet.
// Each view with its OWN side's layers.
const printSvg = (view, theme) => renderBoard(state.project, {
  view, theme, layers: { ...DEFAULT_LAYERS, ...printPrefs.layers[view], drc: false },
});

// The chosen tables' rows, built once: the sheet prints them, and One page
// needs their size to leave room for them.
// Each column's width in mm comes from tableSizeMm, so the sheet and One page's
// arithmetic agree on how wide a table is and how many lines a ref list wraps to.
const printTables = () => [
  printPrefs.tables.bom && { id: 'bom', title: 'Bill of materials', head: ['Qty', 'Refs', 'Value', 'Part'],
    rows: bomFor(state.project).map((r) => [String(r.qty), r.refs.join(', '), r.value, r.part]) },
  printPrefs.tables.cuts && { id: 'cuts', title: 'Cut list', head: ['Where', 'Cut'],
    rows: cutRows(state.project).map((c) => [c.where, c.kind]) },
  printPrefs.tables.wires && { id: 'wires', title: 'Wire runs', head: ['Ref', 'From', 'To'],
    rows: wireRows(state.project).map((w) => [w.ref, w.from, w.to]) },
].filter(Boolean);

const printLayoutFor = (theme, tables) => printLayout({
  drawing: viewBoxSize(printSvg('top', theme)), sides: printPrefs.sides, size: printPrefs.size,
  tablesMm: tablesBlockMm(tables),
});

// ONE SHEET, built here and used twice: once into the preview, once onto paper.
// A preview built separately would be a second thing that can disagree.
export function printSheetHtml() {
  const mono = printPrefs.colour === 'mono';
  const theme = mono ? 'mono' : 'light';
  const tables = printTables();
  const lay = printLayoutFor(theme, tables);
  const caption = {
    top: 'Top, component side',
    underside: 'Bottom, copper side, mirrored',
  };
  const scaleText = printPrefs.size === 'actual'
    ? 'Actual size'
    : `${Math.round(lay.scale * 100)}%, one hole is ${(2.54 * lay.scale).toFixed(1)} mm`;
  // A tick box first on every row: a build sheet is worked down part by part
  // and cut by cut, with a pencil.
  const table = (t) => {
    const { w, cols } = tableSizeMm(t);
    return `<section class="printtable" style="width:${w}mm"><h3>${t.title}</h3>${t.rows.length
      ? `<table data-table="${t.id}"><colgroup>${cols.map((c) => `<col style="width:${c}mm">`).join('')}</colgroup>`
        + `<thead><tr><th class="tick"></th>${t.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`
        + `<tbody>${t.rows.map((row) => `<tr><td class="tick"><i></i></td>${
          row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : '<p class="printnone">None on this board.</p>'}</section>`;
  };
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = `<header class="printhead"><span class="ph-scale">${scaleText}</span>`
    + `<b class="ph-title">${escapeHtml(state.project.name || 'Untitled board')}</b>`
    + `<span class="ph-date">${date}</span></header>`
    + `<div class="printviews is-${lay.arrangement}">${lay.views.map((v) => `<figure class="printview">${
      // Millimetres on the element: the drawing's own units, so actual size
      // really is one hole to 2.54 mm on the paper.
      printSvg(v.view, theme).replace('width="100%" height="100%"',
        `width="${v.widthMm}mm" height="${v.heightMm}mm"`)}<figcaption>${caption[v.view]}</figcaption></figure>`).join('')}</div>`
    + (tables.length ? `<div class="printtables">${tables.map(table).join('')}</div>` : '');
  return { html, mono, lay };
}

export function paintPrintView() {
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
  // A grid: one row per layer, a Top column and a Bot column.
  const layers = $('#pvLayers');
  if (!layers.children.length) {
    layers.innerHTML = '<span class="pv-grid-head">Layer</span><span class="pv-grid-head">Top</span>'
      + '<span class="pv-grid-head">Bot</span>'
      + PRINT_LAYERS.map(([k, label]) => `<span class="pv-grid-name">${escapeHtml(label)}</span>${
        PRINT_SIDES.map((side) => `<input type="checkbox" data-print-layer="${k}" data-side="${side}"
          aria-label="${escapeHtml(label)} on the ${side === 'top' ? 'top' : 'bottom'} view">`).join('')}`).join('');
  }
  for (const box of panel.querySelectorAll('[data-print-layer]')) {
    box.checked = printPrefs.layers[box.dataset.side]?.[box.dataset.printLayer] !== false;
  }
  for (const box of panel.querySelectorAll('[data-print-table]')) box.checked = Boolean(printPrefs.tables[box.dataset.printTable]);

  const { html, mono, lay } = printSheetHtml();
  $('#pvFit').textContent = lay.message;
  $('#pvFit').classList.toggle('is-warn', !lay.fits || lay.readable === false);
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

export function showPrintView(on) {
  state.printing = on;
  $('#printView').hidden = !on;
  $('#stage').classList.toggle('is-printing', on);
  if (on) paintPrintView();
}

// THE PANEL'S OWN LISTENERS, attached once. The panel is never rebuilt — only
// its lit states and its preview are — because listeners added on every repaint
// is what made the Layers card hang. See the note in paintLayers.
export function wirePrintView() {
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
    if (printLayer) printPrefs.layers[e.target.dataset.side][printLayer] = e.target.checked;
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

  // A browser that still prints its own header (Firefox, with its checkbox on)
  // prints the tab title: make that the board's name, not the editor's.
  let titleBeforePrint = null;
  window.addEventListener('beforeprint', () => {
    // Only the first of a nested pair: a second beforeprint would save the
    // board's name as the title to put back.
    if (titleBeforePrint !== null) return;
    titleBeforePrint = document.title;
    document.title = state.project?.name || document.title;
  });
  window.addEventListener('afterprint', () => {
    if (titleBeforePrint !== null) document.title = titleBeforePrint;
    titleBeforePrint = null;
  });
}

// app.js hands over the four things this module cannot import: the live state
// object, the two DOM helpers, and the layer list the panel offers.
export function initPrintView({ state: s, $: q, escapeHtml: esc, layers }) {
  state = s;
  $ = q;
  escapeHtml = esc;
  PRINT_LAYERS = layers;
  printPrefs = readPrefs();
  return printPrefs;
}
