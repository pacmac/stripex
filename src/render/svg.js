// The renderer: a project in, an SVG string out. No DOM, no state, no side effects.
//
// Three callers import this unchanged — the browser editor, the exporter and the
// tests. That is why the editor can be checked in node: a renderer that only
// exists as DOM mutations can only be checked by driving a browser, and a check
// that needs a browser is a check that gets skipped.
//
// Every interactive element carries data-kind and either data-ref or data-hole.
// The browser hit-tests by reading those off event.target, so there is exactly
// one description of where things are — this file — rather than a second
// geometry engine in the editor that can drift out of step with the picture.

import {
  PITCH_MM, TRACK_W_MM, TRACK_GAP_MM, HOLE_DIA_MM, boardSizeMm, holeToMm,
} from '../model/geometry.js';
import { segments } from '../net/segments.js';
import { resolvePins } from '../model/rotate.js';
import { nets as deriveNets, wireRunList } from '../net/derive.js';
import { drc } from '../net/drc.js';
import { effectiveBreaks } from '../model/breaks.js';
import { getPart, sideOf } from '../parts/library.js';

export const THEMES = {
  light: {
    substrate: '#e8dcc0',
    substrateEdge: '#c9b998',
    copper: '#b87333',
    copperDim: '#d9a878',
    copperLit: '#ff9d3c',
    hole: '#3a3226',
    holeRing: '#f3ecdc',
    cut: '#8a7a5c',
    ink: '#241f18',
    wire: '#1f6feb',
    wireInk: '#0a3d91',
    body: '#3d4450',
    bodyInk: '#f5f6f8',
    lead: '#8e9099',
    error: '#d1242f',
    warning: '#bf8700',
    select: '#0a7ea4',
    silk: '#26303d',
    silkFill: '#1d2836',
  },
  dark: {
    substrate: '#2a2418',
    substrateEdge: '#1a160e',
    copper: '#9c6428',
    copperDim: '#6b4620',
    copperLit: '#ffb454',
    hole: '#0d0b07',
    holeRing: '#4a4133',
    cut: '#5d5240',
    ink: '#e8e2d4',
    wire: '#58a6ff',
    wireInk: '#a5d0ff',
    body: '#c3c8d1',
    bodyInk: '#1c1f26',
    lead: '#6a6d75',
    error: '#ff7b72',
    warning: '#e3b341',
    select: '#3fc9f0',
    silk: '#e6ded0',
    silkFill: '#f2ece2',
  },
};

const n = (v) => Math.round(v * 1000) / 1000;
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// --- derived views of a project, shared with the editor's panels -------------

// Everything project-shaped reads effectiveBreaks, never project.breaks: the
// cuts a part requires are derived from the placements rather than stored, so a
// caller that read the stored list would see a board missing half its cuts.
export function netsFor(project) {
  const segs = segments(project.board, effectiveBreaks(project));
  const pins = resolvePins(project.placements ?? [], getPart);
  return deriveNets(segs, pins, project.placements ?? [], getPart, project.wires ?? []);
}

export function findingsFor(project) {
  return drc(project.board, effectiveBreaks(project), project.placements ?? [],
    getPart, project.wires ?? []);
}

export function runList(project) {
  const segs = segments(project.board, effectiveBreaks(project));
  const { segmentNet } = netsFor(project);
  return wireRunList(project.wires ?? [], segmentNet, segs);
}

// The cuts to make, for the exporter's sheet. Derived ones included, or half the
// cuts would be missing from the list you build the board from.
export function cutList(project) {
  return [...effectiveBreaks(project)].sort(
    (a, b) => (a.row - b.row) || (a.x - b.x),
  );
}

// --- part bodies -------------------------------------------------------------
//
// Body dimensions in the library are in HOLE UNITS, so a part keeps its
// proportions if the pitch constant is ever corrected.

// Silkscreen: an outline that says where the part sits and which way round it
// goes, over a wash you can see the board through.
//
// SILK_STROKE_MM is not a taste. Real silkscreen prints at roughly 0.15-0.25 mm,
// and the viewBox is in millimetres, so at this scale a thinner line disappears
// and a thicker one starts reading as a filled shape again.
//
// The wash is not dropped to a pure outline. Over a busy board you need to tell
// which holes are UNDER a part — a hole under a DIP body is one you must not put
// a wire in — and 0.16 says "something is over this" while leaving the strip and
// the hole plainly visible.
const SILK_STROKE_MM = 0.22;
const SILK_FILL_OPACITY = 0.16;

const silk = (c) => `fill="${c.silkFill}" fill-opacity="${SILK_FILL_OPACITY}"`
  + ` stroke="${c.silk}" stroke-width="${SILK_STROKE_MM}"`;

function bodyFor(part, pts, c) {
  const shape = part.body?.shape ?? 'blob';
  const a = pts[0];
  const b = pts[pts.length - 1];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  switch (shape) {
    case 'axial': {
      const bw = (part.body.bodyWidth ?? 0.42) * PITCH_MM * 2;
      const bl = Math.max(len - 1.2 * PITCH_MM, PITCH_MM * 0.8);
      // The cathode band, in the outline colour. On a translucent body a
      // light-on-dark mark would be invisible.
      const bar = part.body.polarised
        ? `<rect x="${n(bl / 2 - bl * 0.16)}" y="${n(-bw / 2)}" width="${n(bl * 0.1)}"`
          + ` height="${n(bw)}" fill="${c.silk}"/>`
        : '';
      return `<g transform="translate(${n(mx)} ${n(my)}) rotate(${n(angle)})">`
        + `<rect data-kind="part-body" x="${n(-bl / 2)}" y="${n(-bw / 2)}"`
        + ` width="${n(bl)}" height="${n(bw)}" rx="${n(bw * 0.22)}" ${silk(c)}/>`
        + `${bar}</g>`;
    }
    case 'can':
    case 'blob': {
      const r = (part.body.radius ?? 1.0) * PITCH_MM * 0.5 + len / 2;
      const mark = part.body.polarised
        ? `<text x="${n(mx - r * 0.5)}" y="${n(my + r * 0.28)}" font-size="${n(r * 0.8)}"`
          + ` fill="${c.silk}" text-anchor="middle" font-family="sans-serif">+</text>`
        : '';
      return `<circle data-kind="part-body" cx="${n(mx)}" cy="${n(my)}" r="${n(r)}"`
        + ` ${silk(c)}/>${mark}`;
    }
    case 'd-package': {
      const r = (part.body.radius ?? 1.1) * PITCH_MM;
      return `<g transform="translate(${n(mx)} ${n(my)}) rotate(${n(angle)})">`
        + `<path data-kind="part-body" d="M ${n(-r)} ${n(-r * 0.55)} A ${n(r)} ${n(r)} 0 1 0`
        + ` ${n(-r)} ${n(r * 0.55)} Z" ${silk(c)}/></g>`;
    }
    case 'tab': {
      const w = (part.body.width ?? 3.2) * PITCH_MM * 0.5;
      const d = (part.body.depth ?? 1.6) * PITCH_MM * 0.5;
      return `<g transform="translate(${n(mx)} ${n(my)}) rotate(${n(angle)})">`
        + `<rect data-kind="part-body" x="${n(-w / 2)}" y="${n(-d)}" width="${n(w)}"`
        + ` height="${n(d * 1.1)}" rx="${n(PITCH_MM * 0.15)}" ${silk(c)}/>`
        // the mounting-tab line, which is how you tell a TO-220's orientation
        + `<line x1="${n(-w / 2)}" y1="${n(-d * 0.66)}" x2="${n(w / 2)}"`
        + ` y2="${n(-d * 0.66)}" stroke="${c.silk}" stroke-width="${SILK_STROKE_MM}"/></g>`;
    }
    case 'dip': {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const pad = PITCH_MM * 0.42;
      const x0 = Math.min(...xs) - pad;
      const y0 = Math.min(...ys) - pad;
      const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
      const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
      // The notch at the pin-1 end and a ring on pin 1 itself: the two marks a
      // real DIL silkscreen carries.
      const horiz = w >= h;
      const notchR = PITCH_MM * 0.34;
      const notch = horiz
        ? `<path d="M ${n(x0)} ${n(y0 + h / 2 - notchR)} A ${n(notchR)} ${n(notchR)} 0 0 0`
          + ` ${n(x0)} ${n(y0 + h / 2 + notchR)}" fill="none" stroke="${c.silk}"`
          + ` stroke-width="${SILK_STROKE_MM}"/>`
        : `<path d="M ${n(x0 + w / 2 - notchR)} ${n(y0)} A ${n(notchR)} ${n(notchR)} 0 0 1`
          + ` ${n(x0 + w / 2 + notchR)} ${n(y0)}" fill="none" stroke="${c.silk}"`
          + ` stroke-width="${SILK_STROKE_MM}"/>`;
      return `<rect data-kind="part-body" x="${n(x0)}" y="${n(y0)}" width="${n(w)}"`
        + ` height="${n(h)}" rx="${n(PITCH_MM * 0.2)}" ${silk(c)}/>${notch}`
        + `<circle cx="${n(pts[0].x)}" cy="${n(pts[0].y)}" r="${n(PITCH_MM * 0.34)}"`
        + ` fill="none" stroke="${c.silk}" stroke-width="${SILK_STROKE_MM}"/>`;
    }
    case 'header': {
      return pts.map((p) => `<rect data-kind="part-body" x="${n(p.x - PITCH_MM * 0.4)}"`
        + ` y="${n(p.y - PITCH_MM * 0.4)}" width="${n(PITCH_MM * 0.8)}"`
        + ` height="${n(PITCH_MM * 0.8)}" ${silk(c)}/>`).join('');
    }
    case 'hole': {
      return `<circle data-kind="part-body" cx="${n(a.x)}" cy="${n(a.y)}"`
        + ` r="${n((part.body.radius ?? 1.4) * PITCH_MM * 0.5)}" fill="none"`
        + ` stroke="${c.silk}" stroke-width="${SILK_STROKE_MM}" stroke-dasharray="1 1"/>`;
    }
    case 'chip': {
      // Drawn at its real size in millimetres, not at a hole pitch: a 0603 is
      // 1.6 x 0.8 mm and sits over the cut, nowhere near filling the 2.54 mm
      // between the holes its pads are modelled at.
      const bl = part.body.lenMm ?? 1.6;
      const bw = part.body.widMm ?? 0.8;
      const cap = bl * 0.22;
      return `<g transform="translate(${n(mx)} ${n(my)}) rotate(${n(angle)})">`
        + `<rect data-kind="part-body" x="${n(-bl / 2)}" y="${n(-bw / 2)}"`
        + ` width="${n(bl)}" height="${n(bw)}" ${silk(c)}/>`
        + `<rect x="${n(-bl / 2)}" y="${n(-bw / 2)}" width="${n(cap)}" height="${n(bw)}"`
        + ` fill="${c.silk}" fill-opacity="0.5"/>`
        + `<rect x="${n(bl / 2 - cap)}" y="${n(-bw / 2)}" width="${n(cap)}" height="${n(bw)}"`
        + ` fill="${c.silk}" fill-opacity="0.5"/></g>`;
    }
    case 'line':
    default:
      return `<line data-kind="part-body" x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}"`
        + ` y2="${n(b.y)}" stroke="${c.silk}" stroke-width="${n(PITCH_MM * 0.18)}"`
        + ' stroke-linecap="round"/>';
  }
}

// --- the renderer ------------------------------------------------------------

// Every layer is visible unless it is switched off. A partial `layers` object is
// merged over these, so an old call site and a saved project that predates the
// feature both open with everything shown.
export const DEFAULT_LAYERS = {
  copper: true,
  breaks: true,
  holes: true,
  wires: true,
  links: true,
  components: true,
  labels: true,
  drc: true,
};

export function renderBoard(project, opts = {}) {
  const {
    view = 'top',
    theme = 'light',
    highlightNet = null,
    findings = [],
    selection = null,
    layers = {},
  } = opts;

  const L = { ...DEFAULT_LAYERS, ...layers };
  const c = THEMES[theme] ?? THEMES.light;
  const b = project.board;
  const { w, h } = boardSizeMm(b);
  const under = view === 'underside';
  const mx = (x) => (under ? w - x : x);

  // Is this object the selected one? Breaks are addressed by "row,x" because a
  // cut has no ref of its own — it is identified by where it is.
  const isSel = (kind, ref) => !!selection && selection.kind === kind
    && String(selection.ref) === String(ref);

  // The halo is a separate element painted BEFORE its object, never a style
  // change on the object itself. A style change is invisible on a part whose
  // body already fills its bounds — the DIP, which is exactly the case where
  // telling parts apart matters most.
  const halo = (ref, body) => `<g data-kind="selection" data-ref="${esc(ref)}">${body}</g>`;

  const cuts = effectiveBreaks(project);
  const segs = segments(b, cuts);
  const { segmentNet } = highlightNet ? netsFor(project) : { segmentNet: {} };

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"`
    + ` data-view="${view}" data-theme="${theme}" width="100%" height="100%">`);

  // 1. substrate
  out.push(`<rect data-kind="substrate" x="0" y="0" width="${n(w)}" height="${n(h)}"`
    + ` fill="${c.substrate}" stroke="${c.substrateEdge}" stroke-width="0.2"/>`);

  // 2. copper — one rect per segment. On the top view the copper is under the
  //    board, so it is drawn faint; on the underside it is what you are looking at.
  const copperFill = under ? c.copper : c.copperDim;
  if (L.copper) {
    for (const g of segs) {
      const lit = highlightNet && segmentNet[g.id] === highlightNet;
      const left = g.x0 * PITCH_MM + (g.x0 > 0 ? TRACK_GAP_MM / 2 : 0);
      const right = (g.x1 + 1) * PITCH_MM - (g.x1 < b.cols - 1 ? TRACK_GAP_MM / 2 : 0);
      const y = holeToMm(0, g.row).y - TRACK_W_MM / 2;
      const x = under ? w - right : left;
      out.push(`<rect data-kind="copper" data-seg="${g.id}"`
        + `${lit ? ' data-highlight="true"' : ''}`
        + ` x="${n(x)}" y="${n(y)}" width="${n(right - left)}" height="${TRACK_W_MM}"`
        + ` fill="${lit ? c.copperLit : copperFill}" opacity="${under ? 1 : 0.55}"/>`);
    }
  }

  // 3. break markers. A break cuts BETWEEN hole x and hole x+1, so its centre is
  //    on the boundary at (x+1)*pitch — never on a hole.
  if (L.breaks) {
    for (const br of cuts) {
      const at = br.at ?? 'gap';
      // A knife cut sits on the boundary between two holes; a spot-face sits ON
      // a hole. Drawing both in the same place would be the off-by-half-a-hole
      // this whole model exists to avoid.
      const bx = at === 'hole' ? holeToMm(br.x, br.row).x : (br.x + 1) * PITCH_MM;
      const y = holeToMm(0, br.row).y;
      const ref = `${br.row},${br.x}`;

      if (isSel('break', ref)) {
        out.push(halo(ref, `<rect x="${n(mx(bx) - PITCH_MM * 0.62)}"`
          + ` y="${n(y - PITCH_MM * 0.62)}" width="${n(PITCH_MM * 1.24)}"`
          + ` height="${n(PITCH_MM * 1.24)}" rx="${n(PITCH_MM * 0.2)}" fill="none"`
          + ` stroke="${c.select}" stroke-width="${n(PITCH_MM * 0.16)}"/>`));
      }

      const marks = isSel('break', ref) ? ' data-selected="true"' : '';
      if (at === 'hole') {
        // The cutter takes out a disc of copper about 3 mm across, wider than
        // the pitch — which is exactly why the hole ends up connected to nothing.
        out.push(`<circle data-kind="break" data-break="${ref}" data-at="hole"`
          + ` data-x="${n(bx)}"${marks} cx="${n(mx(bx))}" cy="${n(y)}"`
          + ` r="${n(PITCH_MM * 0.56)}" fill="${c.substrate}" stroke="${c.cut}"`
          + ` stroke-width="0.12"/>`);
      } else {
        out.push(`<rect data-kind="break" data-break="${ref}" data-at="gap"`
          + ` data-x="${n(bx)}"${marks}`
          + ` x="${n(mx(bx) - TRACK_GAP_MM / 2)}" y="${n(y - TRACK_W_MM / 2 - 0.15)}"`
          + ` width="${n(TRACK_GAP_MM)}" height="${n(TRACK_W_MM + 0.3)}" fill="${c.cut}"/>`);
      }
    }
  }

  // 4. holes
  if (L.holes) {
    for (let row = 0; row < b.rows; row += 1) {
      for (let col = 0; col < b.cols; col += 1) {
        const p = holeToMm(col, row);
        out.push(`<circle data-kind="hole" data-hole="${col},${row}"`
          + ` cx="${n(mx(p.x))}" cy="${n(p.y)}" r="${n(HOLE_DIA_MM / 2)}"`
          + ` fill="${c.hole}" stroke="${c.holeRing}" stroke-width="0.08"/>`);
      }
    }
  }

  // 5. pen wires — insulated, so they may cross each other freely.
  if (L.wires) {
    for (const wire of project.wires ?? []) {
      if (!wire.from || !wire.to) continue;
      const a = holeToMm(wire.from.col, wire.from.row);
      const z = holeToMm(wire.to.col, wire.to.row);
      const sel = isSel('wire', wire.ref);
      if (sel) {
        out.push(halo(wire.ref, `<line x1="${n(mx(a.x))}" y1="${n(a.y)}"`
          + ` x2="${n(mx(z.x))}" y2="${n(z.y)}" stroke="${c.select}"`
          + ` stroke-width="${n(PITCH_MM * 0.52)}" stroke-linecap="round" opacity="0.75"/>`));
      }
      out.push(`<line data-kind="wire" data-ref="${esc(wire.ref)}"`
        + `${sel ? ' data-selected="true"' : ''}`
        + ` x1="${n(mx(a.x))}" y1="${n(a.y)}" x2="${n(mx(z.x))}" y2="${n(z.y)}"`
        + ` stroke="${c.wire}" stroke-width="${n(PITCH_MM * (sel ? 0.3 : 0.2))}"`
        + ' stroke-linecap="round" opacity="0.9"/>');
      if (L.labels) {
        out.push(`<text data-kind="wire-label" data-ref="${esc(wire.ref)}"`
          + ` x="${n((mx(a.x) + mx(z.x)) / 2)}" y="${n((a.y + z.y) / 2 - 0.5)}"`
          + ` font-size="${n(PITCH_MM * 0.62)}" fill="${c.wireInk}" text-anchor="middle"`
          + ` font-family="sans-serif">${esc(wire.ref)}</text>`);
      }
    }
  }

  // 6. components. The underside view drops bodies — you are looking at the
  //    copper you have to solder, and a picture of the parts is in the way.
  for (const pl of project.placements ?? []) {
    let part;
    try { part = getPart(pl.part); } catch { continue; }

    // Links and components are separate layers: a link is a connection you are
    // checking, a component is a part you are placing. Hiding one must not hide
    // the other.
    if (!(part.kind === 'link' ? L.links : L.components)) continue;

    const pins = resolvePins([pl], getPart);
    const pts = pins.map((p) => {
      const q = holeToMm(p.col, p.row);
      return { x: mx(q.x), y: q.y };
    });
    if (!pts.length) continue;

    const sel = isSel('part', pl.ref);
    if (sel) {
      const pad = PITCH_MM * 0.62;
      const x0 = Math.min(...pts.map((p) => p.x)) - pad;
      const y0 = Math.min(...pts.map((p) => p.y)) - pad;
      const bw = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) + pad * 2;
      const bh = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) + pad * 2;
      out.push(halo(pl.ref, `<rect x="${n(x0)}" y="${n(y0)}" width="${n(bw)}"`
        + ` height="${n(bh)}" rx="${n(PITCH_MM * 0.3)}" fill="${c.select}" opacity="0.22"/>`
        + `<rect x="${n(x0)}" y="${n(y0)}" width="${n(bw)}" height="${n(bh)}"`
        + ` rx="${n(PITCH_MM * 0.3)}" fill="none" stroke="${c.select}"`
        + ` stroke-width="${n(PITCH_MM * 0.14)}"/>`));
    }

    // Which side is this part on, and is its body visible from here?
    //
    // A copper-side part is soldered to the track UNDERNEATH the board, so the
    // underside view — the one you solder from — must draw it, and the top view
    // must ghost it rather than pretend it is not there. The underside used to
    // drop every body, which was right when every part was through-hole.
    const side = sideOf(part);
    const showBody = under ? side === 'copper' : true;
    const ghosted = !under && side === 'copper';

    out.push(`<g data-kind="part" data-ref="${esc(pl.ref)}" data-side="${side}"`
      + `${sel ? ' data-selected="true"' : ''}`
      + `${ghosted ? ' opacity="0.42"' : ''}>`);

    if (showBody) {
      // leads first, so the body covers their inner ends. An SMT part has no
      // leads to draw.
      if (pts.length === 2 && side === 'top') {
        out.push(`<line x1="${n(pts[0].x)}" y1="${n(pts[0].y)}" x2="${n(pts[1].x)}"`
          + ` y2="${n(pts[1].y)}" stroke="${c.lead}" stroke-width="${n(PITCH_MM * 0.14)}"/>`);
      }
      out.push(bodyFor(part, pts, c));
      if (L.labels) {
        out.push(`<text data-kind="part-label" data-ref="${esc(pl.ref)}"`
          + ` x="${n(pts[0].x)}" y="${n(Math.min(...pts.map((p) => p.y)) - PITCH_MM * 0.5)}"`
          + ` font-size="${n(PITCH_MM * 0.6)}" fill="${c.ink}" text-anchor="middle"`
          + ` font-family="sans-serif">${esc(pl.value ? `${pl.ref} ${pl.value}` : pl.ref)}</text>`);
      }
    }
    for (const p of pts) {
      out.push(`<circle data-kind="pad" cx="${n(p.x)}" cy="${n(p.y)}"`
        + ` r="${n(PITCH_MM * 0.26)}" fill="none" stroke="${c.lead}" stroke-width="0.12"/>`);
    }
    out.push('</g>');
  }

  // 7. DRC markers
  if (L.drc) {
    for (const f of findings) {
      if (f.severity === 'info') continue;
      for (const hole of f.holes ?? []) {
        if (!hole || hole.col == null) continue;
        const p = holeToMm(hole.col, hole.row);
        out.push(`<circle data-kind="drc" data-code="${esc(f.code)}"`
          + ` data-severity="${f.severity}" cx="${n(mx(p.x))}" cy="${n(p.y)}"`
          + ` r="${n(PITCH_MM * 0.45)}" fill="none"`
          + ` stroke="${f.severity === 'error' ? c.error : c.warning}"`
          + ` stroke-width="${n(PITCH_MM * 0.11)}"/>`);
      }
    }
  }

  out.push('</svg>');
  return out.join('\n');
}
