// THE COMPONENT EDITOR: the screen over the board where a device is made or
// corrected.
//
// Peter: "next task is a component editor screen." Every component problem that
// week needed ME to edit source — the JST body was wrong twice, NC3 and NC4 are
// two names only his silkscreen can settle, and his SMT parts want a 1206 land
// the library does not have. He is the one holding the part.
//
// OVER THE BOARD, NOT BESIDE IT. A device has sixteen pin names, a footprint and
// a preview, and none of that fits in a panel next to a board. The board is left
// untouched underneath: this screen hides, it does not replace.
//
// Its own module for the same reason the Print view is: it reads the catalogue
// and writes its own screen, and shares nothing with the editor but the handful
// of helpers passed to initComponentEditor. See architecture-for-netlist.md.

import { renderBoard, DEFAULT_LAYERS } from '/src/render/svg.js';
import { makeProject } from '/src/model/board.js';
import { resolvePins } from '/src/model/rotate.js';
import { partList, getPart, defaultRotOf, sideOf, CATEGORIES } from '/src/parts/library.js';
import { installDevices } from '/src/parts/devices.js';
import { PITCH_MM } from '/src/model/geometry.js';

// Handed over by app.js: the live state object, the two DOM helpers, the fetch
// wrapper, the status line, a redraw and the palette repaint.
let state = null;
let $ = null;
let escapeHtml = null;
let api = null;
let say = null;
let draw = null;
let paintCards = null;

export function initComponentEditor(deps) {
  ({ state, $, escapeHtml, api, say, draw, paintCards } = deps);
}


// What is being edited. `null` means nothing chosen; a device with no id is a
// new one that has not been saved.
let devEditing = null;
let devIsNew = false;
let devCatalogue = [];

export async function openComponents() {
  $('#componentsScreen').hidden = false;
  await refreshDevices();
  if (!devEditing && devCatalogue.length) await chooseDevice(devCatalogue[0].id);
}

export function closeComponents() {
  $('#componentsScreen').hidden = true;
  // The catalogue may have moved, and the palette lists devices.
  paintCards();
  draw('');
}

export async function refreshDevices() {
  const { ok, body } = await api('/api/devices');
  if (!ok) return say('could not read the component catalogue');
  devCatalogue = body.devices ?? [];
  paintDeviceList();
  return devCatalogue;
}

// The catalogue, grouped and searchable. Fourteen of the sixteen entries are
// JST variants, so without a search the list is a wall of one connector.
export function paintDeviceList() {
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

export async function chooseDevice(id) {
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

export function paintDeviceEditor(builtIn) {
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

export function lightPin(n) {
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
export function readDeviceForm() {
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

export async function saveDevice() {
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

export async function revertDevice() {
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
export async function fetchStoredDevices() {
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


// THE SCREEN'S OWN LISTENERS, attached once at boot, like the Print view's.
export function wireComponentEditor() {
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

}
