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
import { netLabelsByNet } from '../model/nets.js';
import {
  wireColour, silkOf, segmentShade, isWireColoured, linkColour,
} from './colours.js';
import { getPart, getPart as defaultGetPart, sideOf } from '../parts/library.js';

export const THEMES = {
  light: {
    substrate: '#e8dcc0',
    substrateEdge: '#c9b998',
    copper: '#b87333',
    copperDim: '#d9a878',
    // Measured against the unlit copper it has to be told apart from: the old
    // #ff9d3c was 72 apart in RGB, which at 0.55 opacity on a tan board read as
    // pale peach. #ff6a00 is 140 apart, and the highlight is now drawn at full
    // opacity as well.
    copperLit: '#ff6a00',
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
    // Light ground, so the casing is a light halo: it is a white wire that would
    // otherwise vanish here.
    wireCasing: '#fbf7ee',
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
    // Dark ground, so the casing is a dark halo: here it is the black wire that
    // needs rescuing.
    wireCasing: '#0b0906',
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

// A device outline is the extent of its PINS, grown by 0.05 inch on every side.
//
// 0.05 in is half the hole pitch, which is why it is the right number rather
// than a taste: an outline always stops exactly halfway to the next hole, so it
// can never reach a neighbouring pin and two parts on adjacent holes can never
// overlap outlines.
//
// This replaces the per-shape sizes that each part used to carry — bodyLen,
// radius, width, depth — which were guesses and were wrong. A 2-hole
// electrolytic drew an 8.1 mm circle for a part about 5 mm across, because its
// radius grew with the lead span.
export const SILK_MARGIN_MM = PITCH_MM / 2;

// Pad half-extent. Bigger than the 0.5 mm hole radius, so a pad reads as an
// annulus round its hole rather than covering it, and smaller than the half
// pitch, so pads on neighbouring holes can never touch.
export const PAD_R_MM = PITCH_MM * 0.34;

// The pen-wire pad, which is a DIFFERENT THING and gets its own constant. A
// component pad is an outline round a hole; a pen pad is the wire end itself,
// and it has to hold the letter that identifies it — with no line drawn, `A`
// beside `A` is the only thing saying those two holes are joined.
//
// 2.29 mm across on a 2.54 mm pitch: as large as it can be while two pads on
// adjacent holes still show a quarter-millimetre of daylight. The two radii
// being equal before was a coincidence, not a relationship, and PAD_R_MM is
// also the break marker and the DRC ring.
export const PEN_PAD_R_MM = PITCH_MM * 0.45;

// Two characters at 0.62 em is 1.32 mm, which fits inside 2.29 mm with room
// each side — and AA is the widest ID the scheme produces before AAA.
export const PEN_ID_MM = PITCH_MM * 0.42;

// Ink that can be read on a given background. Relative luminance, not a guess:
// the 0.2126/0.7152/0.0722 weights are the standard ones, because the eye is
// far more sensitive to green than to blue and a naive average calls a saturated
// blue "light" when nothing can be read on it.
export function readableOn(background, theme) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(background ?? ''));
  if (!m) return theme.ink;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.4 ? '#141414' : '#f6f6f6';
}

// The same box from already-resolved millimetre points, which is what the
// renderer has to hand — and which is already mirrored for the underside view,
// so the outline follows the pins there too.
export function footprintBoxFromPoints(pts) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x: Math.min(...xs) - SILK_MARGIN_MM,
    y: Math.min(...ys) - SILK_MARGIN_MM,
    w: Math.max(...xs) - Math.min(...xs) + SILK_MARGIN_MM * 2,
    h: Math.max(...ys) - Math.min(...ys) + SILK_MARGIN_MM * 2,
  };
}

// { x, y, w, h } in millimetres. A single-pin part gets a box one hole square:
// its pin extent is a point, and a point grown by half a pitch each way is a
// hole — the right answer rather than a special case.
export function footprintBox(placement, getPart = null) {
  const pins = resolvePins([placement], getPart ?? defaultGetPart);
  const xs = pins.map((p) => holeToMm(p.col, p.row).x);
  const ys = pins.map((p) => holeToMm(p.col, p.row).y);
  const x0 = Math.min(...xs) - SILK_MARGIN_MM;
  const y0 = Math.min(...ys) - SILK_MARGIN_MM;
  return {
    x: x0,
    y: y0,
    w: Math.max(...xs) - Math.min(...xs) + SILK_MARGIN_MM * 2,
    h: Math.max(...ys) - Math.min(...ys) + SILK_MARGIN_MM * 2,
  };
}

const silk = (c) => `fill="${c.silkFill}" fill-opacity="${SILK_FILL_OPACITY}"`
  + ` stroke="${c.silk}" stroke-width="${SILK_STROKE_MM}"`;

// `box` is the footprint: pin extent grown by half a pitch. Every shape is drawn
// inside it, so no shape carries its own size any more — with one deliberate
// exception, the 0603, which really is smaller than its footprint and is drawn
// at its true 1.6 x 0.8 mm.
function bodyFor(part, pts, c, box) {
  const shape = part.body?.shape ?? 'blob';
  const a = pts[0];
  const b = pts[pts.length - 1];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  switch (shape) {
    case 'axial': {
      // The box's short side is the body's width; the long side is inset by a
      // margin at each end so the leads show.
      const bw = Math.min(box.w, box.h);
      const bl = Math.max(len - PITCH_MM * 0.9, PITCH_MM * 0.7);
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
      // A round part is sized by the LONGER side of its box, not the shorter.
      // A radial capacitor's can covers both leads, so its diameter is set by
      // the lead pitch: 2 holes of pitch is 5.08 mm between leads, which is a
      // 10 mm can, not a 5 mm one. Inscribing in the short side would draw a
      // 2.54 mm disc that does not even reach its own pins.
      //
      // It follows that a round body can exceed its courtyard across the short
      // axis. That is what a big capacitor actually does on a board.
      const r = Math.max(box.w, box.h) / 2;
      const mark = part.body.polarised
        ? `<text x="${n(cx - r * 0.5)}" y="${n(cy + r * 0.3)}" font-size="${n(r * 0.9)}"`
          + ` fill="${c.silk}" text-anchor="middle" font-family="sans-serif">+</text>`
        : '';
      return `<circle data-kind="part-body" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"`
        + ` ${silk(c)}/>${mark}`;
    }
    case 'd-package': {
      // A TO-92: a circle with one side flattened. The flat is the face the
      // legend is printed on, and it is how you tell which way round it goes.
      const r = Math.max(box.w, box.h) / 2;
      const flat = r * 0.62;
      return `<g transform="translate(${n(cx)} ${n(cy)}) rotate(${n(angle)})">`
        + `<path data-kind="part-body"`
        + ` d="M ${n(-flat)} ${n(-r)} A ${n(r)} ${n(r)} 0 1 0 ${n(-flat)} ${n(r)} Z"`
        + ` ${silk(c)}/></g>`;
    }
    case 'tab': {
      return `<rect data-kind="part-body" x="${n(box.x)}" y="${n(box.y)}"`
        + ` width="${n(box.w)}" height="${n(box.h)}" rx="${n(PITCH_MM * 0.15)}" ${silk(c)}/>`
        // the mounting-tab line, which is how you tell a TO-220's orientation
        + `<line x1="${n(box.x)}" y1="${n(box.y + box.h * 0.28)}"`
        + ` x2="${n(box.x + box.w)}" y2="${n(box.y + box.h * 0.28)}"`
        + ` stroke="${c.silk}" stroke-width="${SILK_STROKE_MM}"/>`;
    }
    case 'dip': {
      const { x: x0, y: y0, w, h } = box;
      // A plain rounded rectangle. No pin-1 ring and no notch: pin 1 is marked
      // by its SQUARE PAD, on every part alike, and both of those were second
      // ways of saying the same thing on this one package.
      return `<rect data-kind="part-body" x="${n(x0)}" y="${n(y0)}" width="${n(w)}"`
        + ` height="${n(h)}" rx="${n(PITCH_MM * 0.2)}" ${silk(c)}/>`;
    }
    case 'header': {
      // The shroud is the whole box; each way gets a square inside it.
      const ways = pts.map((p) => `<rect x="${n(p.x - PITCH_MM * 0.32)}"`
        + ` y="${n(p.y - PITCH_MM * 0.32)}" width="${n(PITCH_MM * 0.64)}"`
        + ` height="${n(PITCH_MM * 0.64)}" fill="none" stroke="${c.silk}"`
        + ` stroke-width="${SILK_STROKE_MM}"/>`).join('');
      return `<rect data-kind="part-body" x="${n(box.x)}" y="${n(box.y)}"`
        + ` width="${n(box.w)}" height="${n(box.h)}" ${silk(c)}/>${ways}`;
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
  // Separate from `labels` on purpose. That layer is refs and values — R1, 10k,
  // the letter on a pen wire — which name the parts YOU placed. A net name is
  // derived from where the copper runs, nothing placed it, and it repeats on
  // every segment of its net. Wanting the captions off is not wanting R1 off.
  netNames: true,
  drc: true,
};

// The plate behind a net name, sized without a text metric — this renderer has
// no DOM to measure in.
//
// 0.62 em per character is sans-serif at weight 600, averaged; the padding is
// what absorbs the error. The font SHRINKS to fit its segment rather than
// letting the text spill, because a name spilling off its plate is the very
// defect this exists to fix — letters back over the holes, now with a plate
// pointing at them. Below MIN_NAME_MM the name is dropped for that segment,
// which is safe only because it is drawn on every segment of the net.
const NAME_EM = 0.62;
// Half an em of clear space each side. IN EM, not millimetres: a fixed pad looks
// generous at full size and cramped the moment the font shrinks to fit a short
// segment, which is where the letters are already tightest.
const NAME_PAD_EM = 0.5;
const MIN_NAME_MM = PITCH_MM * 0.3;

export function namePlate(name, segWidthMm, baseFontMm) {
  const text = String(name ?? '');
  if (!text || !(segWidthMm > 0)) return { show: false, w: 0, h: 0, fontSize: 0 };
  // Width is one multiple of the font size, so the fit inverts exactly rather
  // than being solved by trial.
  const ems = NAME_EM * text.length + NAME_PAD_EM * 2;
  const fontSize = Math.min(baseFontMm, segWidthMm / ems);
  if (fontSize < MIN_NAME_MM) return { show: false, w: 0, h: 0, fontSize: 0 };
  return {
    show: true,
    fontSize,
    w: fontSize * ems,
    // Inside the track, so it can never be mistaken for copper bridging two rows.
    h: TRACK_W_MM * 0.92,
  };
}

export function renderBoard(project, opts = {}) {
  const {
    view = 'top',
    theme = 'light',
    highlightNet = null,
    findings = [],
    selection = null,
    layers = {},
    moveAnchor = null,
    pendingWire = null,
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

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"`
    + ` data-view="${view}" data-theme="${theme}" width="100%" height="100%">`);

  // 1. substrate
  out.push(`<rect data-kind="substrate" x="0" y="0" width="${n(w)}" height="${n(h)}"`
    + ` fill="${c.substrate}" stroke="${c.substrateEdge}" stroke-width="0.2"/>`);

  // 2. copper — one rect per segment. On the top view the copper is under the
  //    board, so it is drawn faint; on the underside it is what you are looking at.
  const copperFill = under ? c.copper : c.copperDim;
  // Net names and colours, anchored to a hole rather than to a net id — see
  // src/model/nets.js for why a net cannot own its own name.
  const netSegNet = (highlightNet || project.netLabels) ? netsFor(project).segmentNet : {};
  const labels = project.netLabels ? netLabelsByNet(project, netSegNet) : new Map();
  // Filled by the copper pass, drawn on top of everything — see pass 7b.
  const netNames = [];

  if (L.copper) {
    for (const g of segs) {
      const netId = netSegNet[g.id];
      const lit = highlightNet && netId === highlightNet;
      const label = labels.get(netId) ?? null;
      const left = g.x0 * PITCH_MM + (g.x0 > 0 ? TRACK_GAP_MM / 2 : 0);
      const right = (g.x1 + 1) * PITCH_MM - (g.x1 < b.cols - 1 ? TRACK_GAP_MM / 2 : 0);
      const y = holeToMm(0, g.row).y - TRACK_W_MM / 2;
      const x = under ? w - right : left;
      // Adjacent segments of one row alternate shades. A highlighted net is
      // NOT shaded: highlighting has to stay unambiguous.
      const segIndex = Number(g.id.split(':')[2]) || 0;
      const fill = lit
        ? c.copperLit
        : (label?.colour ?? segmentShade(copperFill, segIndex));

      // A HIGHLIGHTED SEGMENT IS NOT COPPER SEEN THROUGH THE BOARD — it is the
      // answer to a question. The top view washes copper to 0.55 because it is
      // underneath; the highlight inherited that wash and arrived as pale peach
      // on a tan ground, so the strip under the pointer read as lit and ones
      // further off did not. It looked like the net stopped.
      const opacity = lit ? 1 : (under ? 1 : 0.55);

      out.push(`<rect data-kind="copper" data-seg="${g.id}"`
        + `${lit ? ' data-highlight="true"' : ''}`
        + `${label?.name ? ` data-net-name="${esc(label.name)}"` : ''}`
        + ` x="${n(x)}" y="${n(y)}" width="${n(right - left)}" height="${TRACK_W_MM}"`
        + ` fill="${fill}" opacity="${opacity}"/>`);

      // The name on every segment it covers, so GND reads across the board
      // without selecting anything — but NOT drawn here. It is collected and
      // emitted as pass 7b, on top of everything: this pass is step 2, so a
      // name written here came back punched through by every hole it lay over
      // and hidden under every part that crossed it.
      if (label?.name && L.netNames) {
        netNames.push({ id: g.id, name: label.name, ground: fill, x, y, w: right - left });
      }
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
      const ink = wireColour(wire);

      // THE WIRE IS NOT DRAWN. A pen wire appears as two pads sharing an ID, so
      // forty of them do not become spaghetti laid over the board you are
      // trying to read.
      //
      // The line comes back only while the wire is SELECTED, which is the answer
      // to "is A really wired to A?" — one wire's path, when you ask for it. The
      // casing goes with it, since it exists to keep a black or white line
      // legible.
      if (sel) {
        const width = PITCH_MM * 0.3;
        out.push(`<line data-kind="wire-casing" data-ref="${esc(wire.ref)}"`
          + ` x1="${n(mx(a.x))}" y1="${n(a.y)}" x2="${n(mx(z.x))}" y2="${n(z.y)}"`
          + ` stroke="${c.wireCasing}" stroke-width="${n(width + PITCH_MM * 0.09)}"`
          + ' stroke-linecap="round" opacity="0.55" pointer-events="none"/>');
        out.push(`<line data-kind="wire" data-ref="${esc(wire.ref)}"`
          + ' data-selected="true"'
          + ` x1="${n(mx(a.x))}" y1="${n(a.y)}" x2="${n(mx(z.x))}" y2="${n(z.y)}"`
          + ` stroke="${ink}" stroke-width="${n(width)}"`
          + ' stroke-linecap="round" opacity="0.75" pointer-events="none"/>');
      }

      // Both ends identical: a pen wire has no polarity and no direction, and
      // marking one differently would imply an order that does not exist. Filled,
      // so a wire pad reads differently from a component pad, which is an
      // outline. In the wire's LENGTH colour, which matters more without a line
      // than with one — it says which pre-cut wire to take from the drawer.
      const padR = n(PEN_PAD_R_MM);
      for (const [end, hole, pt] of [['from', wire.from, a], ['to', wire.to, z]]) {
        out.push(`<circle data-kind="wire-pad" data-ref="${esc(wire.ref)}"`
          + ` data-end="${end}" data-hole="${hole.col},${hole.row}"`
          + `${sel ? ' data-selected="true"' : ''} pointer-events="all"`
          + ` cx="${n(mx(pt.x))}" cy="${n(pt.y)}" r="${padR}"`
          + ` fill="${ink}" stroke="${c.wireCasing}"`
          + ` stroke-width="${n(SILK_STROKE_MM * 0.7)}"/>`);
        if (L.labels) {
          // INSIDE the pad, centred: the pad and its ID are one mark, not a
          // marker with a caption. Above it, the ID was larger than the pad it
          // named and sat in the gap between rows, where it collided with the
          // row above and with the next wire's ID.
          //
          // Which means the ink is now chosen against the LENGTH COLOUR it sits
          // on. A fixed one vanishes the moment the wire is the black one — and
          // black is 0 in the colour code, so it is the first wire anyone draws.
          // An explicit silk still wins: that is a choice, and not this code's
          // to overrule.
          const labelInk = wire.silk ?? readableOn(ink, c);
          out.push(`<text data-kind="wire-label" data-ref="${esc(wire.ref)}"`
            + ` data-end="${end}" x="${n(mx(pt.x))}"`
            + ` y="${n(pt.y + PEN_ID_MM * 0.35)}"`
            + ` font-size="${n(PEN_ID_MM)}" fill="${labelInk}" text-anchor="middle"`
            + ` font-family="sans-serif" pointer-events="none"`
            + ` font-weight="600">${esc(wire.ref)}</text>`);
          if (wire.value) {
            out.push(`<text data-kind="wire-value" data-ref="${esc(wire.ref)}"`
              + ` data-end="${end}" x="${n(mx(pt.x))}"`
              + ` y="${n(pt.y + PEN_PAD_R_MM + PITCH_MM * 0.42)}"`
              + ` font-size="${n(PITCH_MM * 0.5)}" fill="${labelInk}" text-anchor="middle"`
              + ' font-family="sans-serif" pointer-events="none"'
              + `>${esc(wire.value)}</text>`);
          }
        }
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
      // The part's own silkscreen colour, if it has one. Only the body and its
      // outline: the pads below keep the theme colour, so a pale part on a pale
      // board cannot make its own pads unreadable.
      //
      // A WIRE LINK is a piece of wire, so its body takes the wire colour for
      // its span instead — while its pads still take silkscreen. Overriding its
      // silk recolours the pads and leaves the wire; overriding its colour
      // recolours the wire and leaves the pads.
      const bodyInk = isWireColoured(part)
        ? linkColour(pl, part)
        : silkOf(pl, part, c.silk);
      out.push(bodyFor(part, pts, { ...c, silk: bodyInk, silkFill: bodyInk },
        footprintBoxFromPoints(pts)));
      if (L.labels) {
        out.push(`<text data-kind="part-label" data-ref="${esc(pl.ref)}"`
          + ` x="${n(pts[0].x)}" y="${n(Math.min(...pts.map((p) => p.y)) - PITCH_MM * 0.5)}"`
          + ` font-size="${n(PITCH_MM * 0.6)}" fill="${c.ink}" text-anchor="middle"`
          + ` font-family="sans-serif">${esc(pl.value ? `${pl.ref} ${pl.value}` : pl.ref)}</text>`);
      }
    }
    // Pads, at the silkscreen weight so they are as legible as the outline
    // beside them. They used to be 0.12 mm in a mid grey — about a fifth that
    // weight — which is why every pad but pin 1 read as absent.
    //
    // PIN 1 IS SQUARE and the rest are round: the board convention, and the same
    // whether the part is polarised or not. Both are drawn to the same half
    // extent, because the distinction is meant to be read as SHAPE, not weight.
    //
    // pointer-events="all" because the fill is none: without it only the stroke
    // is hit-testable and a click in the middle falls through to whatever is
    // underneath, which makes the move tool impossible to aim.
    // One rounded radius for both shapes: rounding each independently made the
    // square 1.727 mm across where the circle was 1.728, and the whole point of
    // matching their extents is that they read as the same size.
    // Pads take the part's SILKSCREEN colour — including a wire link's, whose
    // body is wire-coloured while its pads are silk. A pad is a silkscreen
    // marking, not copper, so a part's silkscreen colour has to paint it.
    const padInk = silkOf(pl, part, c.silk);
    const padR = n(PAD_R_MM);
    for (const [i, p] of pts.entries()) {
      const pinName = pins[i]?.pin ?? '';
      const common = `data-kind="pad" data-pin="${esc(pinName)}"`
        + ` data-first="${i === 0}" pointer-events="all"`
        + ` fill="none" stroke="${padInk}" stroke-width="${SILK_STROKE_MM}"`;
      out.push(i === 0
        ? `<rect ${common} x="${n(p.x - padR)}" y="${n(p.y - padR)}"`
          + ` width="${padR * 2}" height="${padR * 2}"/>`
        : `<circle ${common} cx="${n(p.x)}" cy="${n(p.y)}" r="${padR}"/>`);
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

  // 7b. net names, on an opaque plate. THE TOP LAYER.
  //
  // After the holes, which is the defect it was written for: 1.0 mm of dark
  // hole painted over a 1.4 mm typeface takes most of the letter with it, and a
  // name over three holes came back as fragments.
  //
  // And after the wires, the bodies and the check markers, which reverses what
  // this pass first did. The old reasoning — a name is annotation OF the board,
  // so objects ON the board belong above it — suits a photograph of a finished
  // board. In a layout editor the names are what you read the board BY, and the
  // very case it argued for, a DIP across a labelled strip, is where the name
  // matters most and is exactly where it disappeared. A crossing wire stays
  // legible under a 1.8 mm pill; a name under a component body does not.
  //
  // Only the hit targets and the armed move handle stay above, and neither is a
  // picture of the board: the targets are invisible and the name is
  // pointer-events="none", and covering the pin being dragged would be this
  // same defect in a new place.
  //
  // The plate is the segment's own colour at FULL opacity — not a badge in some
  // new colour, so it reads as a solid patch of that strip. That also makes the
  // ink honest: on the top view the copper is drawn at 0.55 and blends with the
  // substrate, so `readableOn(fill)` was choosing ink for a colour that was not
  // on screen. Now it is.
  for (const nn of netNames) {
    const plate = namePlate(nn.name, nn.w, PITCH_MM * 0.55);
    if (!plate.show) continue;
    const cx = nn.x + nn.w / 2;
    const cy = nn.y + TRACK_W_MM / 2;
    const ink = readableOn(nn.ground, c);
    out.push(`<rect data-kind="net-name-plate" data-seg="${nn.id}"`
      + ` x="${n(cx - plate.w / 2)}" y="${n(cy - plate.h / 2)}"`
      + ` width="${n(plate.w)}" height="${n(plate.h)}" rx="${n(plate.h / 2)}"`
      // The hairline the holes already use. On the underside the strip is
      // already opaque, so without an edge the plate has no shape at all and
      // the name floats.
      + ` fill="${nn.ground}" stroke="${ink}" stroke-width="0.08"`
      + ` stroke-opacity="0.22" pointer-events="none"/>`);
    out.push(`<text data-kind="net-name" data-name="${esc(nn.name)}"`
      + ` data-seg="${nn.id}" x="${n(cx)}"`
      + ` y="${n(cy + plate.fontSize * 0.35)}" font-size="${n(plate.fontSize)}"`
      + ` fill="${ink}" text-anchor="middle" font-family="sans-serif"`
      + ` pointer-events="none" font-weight="600">${esc(nn.name)}</text>`);
  }

  // 8. hit targets for the cuts.
  //
  // A part is painted after the breaks, so its body — translucent, but painted —
  // was the topmost element over any cut beneath it and took the click. Every
  // cut under a DIL was unreachable, which is exactly the set a DIL creates.
  //
  // These are invisible, so the drawing is unchanged and the cuts still show
  // THROUGH the body where they physically are. They exist only to be clicked,
  // and precision decides who wins: a cut's target is at most 2.8 mm across
  // against a body tens of millimetres wide, so clicking exactly on the cut
  // gets the cut and clicking anywhere else on the part gets the part.
  //
  // Emitted only when the breaks layer is visible: a hidden layer that still
  // swallowed clicks is the fault the layer feature exists to avoid.
  if (L.breaks) {
    for (const br of cuts) {
      const at = br.at ?? 'gap';
      const bx = at === 'hole' ? holeToMm(br.x, br.row).x : (br.x + 1) * PITCH_MM;
      const y = holeToMm(0, br.row).y;
      // Deliberately SMALLER than the drawn marker, and no bigger than a pad.
      // A generous target measured 44% of a DIL's body: seven of them down the
      // middle of a 12.7 mm-wide package, so selecting the chip was close to a
      // coin flip. Sized like a pad it is comfortably clickable — pads are
      // clicked all the time by the move tool — while leaving the body the
      // obvious thing to hit.
      const common = `data-kind="break-hit" data-break="${br.row},${br.x}"`
        + ` data-at="${at}" fill="none" pointer-events="all"`;
      out.push(at === 'hole'
        ? `<circle ${common} cx="${n(mx(bx))}" cy="${n(y)}" r="${n(PAD_R_MM)}"/>`
        : `<rect ${common} x="${n(mx(bx) - PAD_R_MM * 0.6)}"`
          + ` y="${n(y - TRACK_W_MM / 2)}" width="${n(PAD_R_MM * 1.2)}"`
          + ` height="${n(TRACK_W_MM)}"/>`);
    }
  }

  // 9. the armed move handle, drawn last so nothing covers the pin you are
  //    about to move the part by. Not the selection halo: a part can be selected
  //    and not armed, and armed without being selected.
  if (moveAnchor && Number.isInteger(moveAnchor.col)) {
    const p = holeToMm(moveAnchor.col, moveAnchor.row);
    out.push(`<circle data-kind="move-anchor" data-ref="${esc(moveAnchor.ref ?? '')}"`
      + ` data-pin="${esc(moveAnchor.pin ?? '')}" cx="${n(mx(p.x))}" cy="${n(p.y)}"`
      + ` r="${n(PITCH_MM * 0.42)}" fill="${c.select}" fill-opacity="0.35"`
      + ` stroke="${c.select}" stroke-width="${n(PITCH_MM * 0.14)}"/>`);
  }

  // 10. the half-drawn wire.
  //
  // Before this, the first click of a point-to-point wire changed NOTHING on the
  // board — the element inventory was identical before and after — and the only
  // feedback was one line of text at the bottom edge of the window, nowhere near
  // where you are looking or clicking.
  //
  // The marker uses the selection colour, the same as the move anchor, because
  // both mean the same thing: the editor is holding this point and waiting for
  // you. They should not look like two different mechanisms.
  //
  // Both are pointer-events="none". The band follows the cursor, so it lies
  // directly under the pointer at the moment of the second click and would
  // otherwise eat it.
  if (pendingWire && Number.isInteger(pendingWire.col) && Number.isInteger(pendingWire.row)) {
    const p = holeToMm(pendingWire.col, pendingWire.row);
    const px = n(mx(p.x));
    const py = n(p.y);
    // Emitted collapsed onto the hole; the editor moves x2/y2 on mousemove by
    // setting them on THIS element, never by re-rendering — renderBoard builds
    // the whole board as a string, and doing that per mousemove would rebuild
    // five hundred holes to move one line.
    out.push(`<line data-kind="wire-band" x1="${px}" y1="${py}" x2="${px}" y2="${py}"`
      + ` stroke="${c.select}" stroke-width="${n(PITCH_MM * 0.18)}"`
      + ' stroke-linecap="round" stroke-dasharray="1.2 0.9" opacity="0.85"'
      + ' pointer-events="none"/>');
    out.push(`<circle data-kind="wire-start"`
      + ` data-hole="${pendingWire.col},${pendingWire.row}"`
      // The pad you are about to place, at the size you will get. A preview of
      // the wrong size is a lie about what you are doing.
      + ` cx="${px}" cy="${py}" r="${n(PEN_PAD_R_MM)}" fill="${c.select}" fill-opacity="0.3"`
      + ` stroke="${c.select}" stroke-width="${n(PITCH_MM * 0.14)}"`
      + ' pointer-events="none"/>');
  }

  out.push('</svg>');
  return out.join('\n');
}
