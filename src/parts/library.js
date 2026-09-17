// The built-in generic part set.
//
// A part is GEOMETRY ONLY. It carries no value, no reference designator and no
// placement — those belong to the project. Pin offsets are in holes, relative to
// the placement anchor, before rotation.
//
// This module is imported unchanged by the server, the tests and the browser.
// That is deliberate: a part list serialised to JSON for the client would be a
// second copy of the truth, and the pin generators below (DIP, header) cannot
// survive serialisation anyway.
//
// `kind: "link"` is the ONLY zero-ohm kind. It is what tells the net derivation
// that a part merges the strips it bridges instead of sitting between them.

// Standard DIP numbering: pin 1 at the anchor, along one row, then back down the
// other row. `width` is the row spacing in holes — 3 for the 0.3 inch package,
// 4 for 0.4 inch, 6 for the 0.6 inch one that 24- and 40-pin devices come in.
//
// The second row is at dy = -width, NOT +width. Rotation maps (dx, dy) to
// (-dy, dx), so at rot 90 — the orientation a DIL is actually used in on
// stripboard, straddling the strips — a second row at +width lands at negative
// x and puts PIN 1 ON THE RIGHT, numbering down the right column and up the
// left. That is backwards. At -width it lands at +x: pin 1 top-left, 1..n down
// the left column, n+1..2n back up the right, which is the convention.
//
// The cost, stated rather than buried: at rot 0 the package extends upward from
// its anchor, because pin 1 is still the anchor.
const dipPins = (span, width = 3) => {
  const pins = [];
  for (let i = 0; i < span; i += 1) pins.push({ name: String(i + 1), dx: i, dy: 0 });
  for (let i = 0; i < span; i += 1) {
    pins.push({ name: String(span + i + 1), dx: span - 1 - i, dy: -width });
  }
  return pins;
};

const headerPins = (span) => {
  const pins = [];
  for (let i = 0; i < span; i += 1) pins.push({ name: String(i + 1), dx: i, dy: 0 });
  return pins;
};

// The categories the library groups by, in display order.
//
// Declared while there are fourteen parts rather than when there are sixty:
// retrofitting a taxonomy means touching every entry and every caller, and the
// component library this is being shaped for will arrive as data, not as a
// reason to restructure.
export const CATEGORIES = [
  { id: 'wiring', name: 'Wiring' },
  { id: 'passive', name: 'Passives' },
  { id: 'semiconductor', name: 'Semiconductors' },
  { id: 'ic', name: 'ICs and sockets' },
  { id: 'module', name: 'Modules' },
  { id: 'smt', name: 'Surface mount' },
  { id: 'connector', name: 'Connectors' },
  { id: 'mechanical', name: 'Mechanical' },
];

export const PARTS = {
  // Point to point is in this list rather than beside it, so the palette stays
  // built from ONE source. `places: 'wire'` is what makes that work: choosing it
  // arms the wire tool instead of the place tool.
  //
  // A second list for the palette is the defect that already cost this project
  // once, when ref prefixes lived in board.js, drifted from the library, and
  // shipped a part called "X1".
  'point-to-point': {
    id: 'point-to-point',
    category: 'wiring',
    name: 'Point to point (pen)',
    refPrefix: 'A',
    kind: 'link',
    places: 'wire',
    parametric: null,
    // No pins: a pen wire is not a placement. Its two ends live on the wire
    // itself, and validateProject refuses a placement that names this part —
    // nothing else would catch it, because no pins means no geometry and it
    // would simply be invisible.
    pins: [],
    body: { shape: 'none' },
  },
  'wire-link': {
    id: 'wire-link',
    category: 'wiring',
    name: 'Wire link',
    refPrefix: 'L',
    kind: 'link',
    // Across the strips. Along one, a link joins a segment to itself. This was
    // a typed `defaultRot: 90`; it is now the declaration the rotation is
    // derived from, the same as every other part.
    pinsRun: 'across',
    parametric: 'span',
    spanLabel: 'length in holes',
    defaultSpan: 2,
    minSpan: 1,
    pins: [{ name: '1', dx: 0, dy: 0 }, { name: '2', dx: 'span', dy: 0 }],
    body: { shape: 'line' },
  },
  'res-axial': {
    id: 'res-axial',
    pinsRun: 'across',
    category: 'passive',
    name: 'Resistor (axial)',
    refPrefix: 'R',
    kind: 'component',
    parametric: 'span',
    spanLabel: 'lead pitch in holes',
    defaultSpan: 4,
    minSpan: 2,
    pins: [{ name: '1', dx: 0, dy: 0 }, { name: '2', dx: 'span', dy: 0 }],
    body: { shape: 'axial', bodyLen: 0.6, bodyWidth: 0.42 },
  },
  diode: {
    id: 'diode',
    pinsRun: 'across',
    category: 'semiconductor',
    name: 'Diode (axial)',
    refPrefix: 'D',
    kind: 'component',
    parametric: 'span',
    spanLabel: 'lead pitch in holes',
    defaultSpan: 3,
    minSpan: 2,
    pins: [{ name: 'A', dx: 0, dy: 0 }, { name: 'K', dx: 'span', dy: 0 }],
    body: { shape: 'axial', bodyLen: 0.5, bodyWidth: 0.36, polarised: true },
  },
  'cap-ceramic': {
    id: 'cap-ceramic',
    pinsRun: 'across',
    category: 'passive',
    name: 'Capacitor (ceramic)',
    refPrefix: 'C',
    kind: 'component',
    parametric: 'span',
    spanLabel: 'lead pitch in holes',
    defaultSpan: 2,
    minSpan: 1,
    pins: [{ name: '1', dx: 0, dy: 0 }, { name: '2', dx: 'span', dy: 0 }],
    body: { shape: 'blob' },
  },
  'cap-electro': {
    id: 'cap-electro',
    pinsRun: 'across',
    category: 'passive',
    name: 'Capacitor (electrolytic)',
    refPrefix: 'C',
    kind: 'component',
    parametric: 'span',
    spanLabel: 'lead pitch in holes',
    defaultSpan: 2,
    minSpan: 1,
    pins: [{ name: '+', dx: 0, dy: 0 }, { name: '-', dx: 'span', dy: 0 }],
    body: { shape: 'can', radius: 1.2, polarised: true },
  },
  led: {
    id: 'led',
    pinsRun: 'across',
    category: 'semiconductor',
    name: 'LED',
    refPrefix: 'LED',
    kind: 'component',
    parametric: null,
    pins: [{ name: 'A', dx: 0, dy: 0 }, { name: 'K', dx: 1, dy: 0 }],
    body: { shape: 'can', radius: 0.9, polarised: true },
  },
  to92: {
    id: 'to92',
    pinsRun: 'across',
    category: 'semiconductor',
    // Named by PACKAGE. A TO-92 holds a BJT, a FET, a 78L05 or a reference
    // diode equally; what is in it belongs to a device entry.
    name: 'TO-92, 3 pins',
    refPrefix: 'Q',
    kind: 'component',
    parametric: null,
    pins: [
      { name: '1', dx: 0, dy: 0 },
      { name: '2', dx: 1, dy: 0 },
      { name: '3', dx: 2, dy: 0 },
    ],
    body: { shape: 'd-package', radius: 1.1 },
  },
  to220: {
    id: 'to220',
    pinsRun: 'across',
    category: 'semiconductor',
    name: 'TO-220, 3 pins',
    refPrefix: 'Q',
    kind: 'component',
    parametric: null,
    pins: [
      { name: '1', dx: 0, dy: 0 },
      { name: '2', dx: 1, dy: 0 },
      { name: '3', dx: 2, dy: 0 },
    ],
    body: { shape: 'tab', width: 3.2, depth: 1.6 },
  },
  dip: {
    id: 'dip',
    pinsRun: 'across',
    category: 'ic',
    name: 'DIP / IC socket',
    refPrefix: 'U',
    kind: 'component',
    parametric: 'span',
    spanLabel: 'pins per side',
    defaultSpan: 7,
    minSpan: 2,
    // A DIL has TWO dimensions. Width is the row spacing in holes: 3 = 0.3 in,
    // 4 = 0.4 in, 6 = 0.6 in.
    widthLabel: 'body width in holes (3 = 0.3 in)',
    defaultWidth: 3,
    minWidth: 2,
    // Every strip running under the package joins a pin to its opposite pin, so
    // a DIL cannot work until each of those strips is cut. There are holes
    // between the two pin rows, so the cut is a drilled one — you spot-face the
    // hole rather than trying to get a knife under the chip.
    requiresBreak: true,
    breakType: 'spot-face',
    pins: dipPins,
    body: { shape: 'dip' },
  },
  'smt-0603': {
    id: 'smt-0603',
    // EITHER, and that is measured, not a shrug. Along one strip it straddles a
    // knife cut; turned a quarter it bridges the gap between two adjacent strips
    // and needs no cut at all — 1.6 mm reaches half a millimetre onto each. Both
    // are built: 555-blinker-v2 has six at 90, rak4631-io has them both ways.
    // Declaring one would warn on working boards. It still places at 0.
    pinsRun: 'either',
    category: 'smt',
    name: 'SMT resistor 0603',
    refPrefix: 'R',
    kind: 'component',
    // Soldered to the copper on the UNDERSIDE, straddling a cut. It does not go
    // through a hole, so its pads leave the holes free for through-hole leads.
    side: 'copper',
    requiresBreak: true,
    // The pads are in adjacent holes, so there is no hole between them to drill:
    // it has to be a knife cut in the gap.
    breakType: 'knife',
    parametric: null,
    // Modelled at two adjacent holes because that records which segments the
    // part joins, which is what the netlist needs.
    //
    // The chip itself is 1.6 x 0.8 mm and that size is NOT recorded here: the
    // body is drawn as the LAND it occupies, across both holes and just inside
    // the strip, because 0.8 mm of translucent silk on a 2.0 mm track is
    // accurate and invisible. See docs/specs/smt-land-pattern.md. A size in
    // this file that nothing read would be one more thing to drift.
    pins: [{ name: '1', dx: 0, dy: 0 }, { name: '2', dx: 1, dy: 0 }],
    body: { shape: 'chip' },
  },
  'smt-0603-cap': {
    id: 'smt-0603-cap',
    // Either way, as the resistor above.
    pinsRun: 'either',
    category: 'smt',
    name: 'SMT capacitor 0603',
    refPrefix: 'C',
    kind: 'component',
    side: 'copper',
    requiresBreak: true,
    // The pads are in adjacent holes, so there is no hole between them to drill:
    // it has to be a knife cut in the gap.
    breakType: 'knife',
    parametric: null,
    pins: [{ name: '1', dx: 0, dy: 0 }, { name: '2', dx: 1, dy: 0 }],
    // Drawn as its land, like the resistor above it.
    body: { shape: 'chip' },
  },
  // A SOT-23, soldered to the copper across two adjacent strips. See
  // docs/specs/sot23-and-accepted-findings.md.
  //
  // A 2+1 STRADDLE, NOT THREE IN A ROW. Pins 1 and 2 share one strip, 1.9 mm
  // apart, so the strip is knife-cut between them exactly as for an 0603. Pin 3
  // is on the next strip, centred between them — which puts it over the gap
  // between two holes rather than on one.
  //
  // `ox` is that half hole. It is an offset for the DRAWING only: pin 3's
  // connectivity hole stays on the grid, because nothing can lie between two
  // holes of one uncut strip. Where a cut does lie there, the DRC says so
  // (pad-over-cut), and turned across the strips it cannot be built at all
  // (pad-between-strips).
  //
  // WHICH WAY ROUND. The part is chiral. Marking side up it reads pin 1
  // bottom-left, 2 bottom-right, 3 top centre; on the copper side the marking
  // faces away from the board, so the underside view — which mirrors x — is the
  // one that has to match. Pin 3 at +dy gives it that handedness.
  //
  // Pins are 1, 2 and 3 and nothing else: G/S/D is the device's business, and
  // two SOT-23 parts do not agree about it.
  sot23: {
    id: 'sot23',
    // Pins 1 and 2 along one strip; pin 3 is on the next by construction.
    pinsRun: 'along',
    category: 'smt',
    // Named by package, not function: Peter, "could be a FET, a Transistor, a
    // Regulator, a Diode." For the same reason it takes the generic U; a
    // device entry says Q or D when it knows.
    name: 'SOT-23, 3 pins',
    refPrefix: 'U',
    kind: 'component',
    side: 'copper',
    requiresBreak: true,
    breakType: 'knife',
    parametric: null,
    pins: [
      { name: '1', dx: 0, dy: 0 },
      { name: '2', dx: 1, dy: 0 },
      { name: '3', dx: 0, dy: 1, ox: 0.5 },
    ],
    body: { shape: 'sot23' },
  },
  header: {
    id: 'header',
    pinsRun: 'across',
    category: 'connector',
    name: 'Pin header',
    refPrefix: 'J',
    kind: 'component',
    parametric: 'span',
    spanLabel: 'ways',
    defaultSpan: 2,
    minSpan: 1,
    pins: headerPins,
    body: { shape: 'header' },
  },
  // A shrouded, keyed connector: one row of pins like a header, but drawn with
  // the shroud and the locking ramp, because the ramp is what tells you which
  // way round it goes and a box does not.
  //
  // JST XH is 2.5 mm pitch and this board is 2.54 mm. Over 8 ways that is
  // 0.28 mm of drift, under half a hole, so it solders in — the footprint is at
  // the BOARD's pitch because that is where the holes are, and the series is in
  // the device name so the difference is visible when you choose one.
  'jst-xh': {
    id: 'jst-xh',
    pinsRun: 'across',
    category: 'connector',
    name: 'JST XH connector',
    refPrefix: 'J',
    kind: 'component',
    parametric: 'span',
    spanLabel: 'ways',
    defaultSpan: 2,
    minSpan: 2,
    pins: headerPins,
    // `angle` is read off the PLACEMENT, not from here: straight and right
    // angle are separate devices over this one footprint.
    body: { shape: 'jst' },
  },
  'mount-hole': {
    id: 'mount-hole',
    category: 'mechanical',
    name: 'Mounting hole',
    refPrefix: 'MH',
    kind: 'component',
    parametric: null,
    // Occupies a hole, joins no net. This is what `electrical: false` is for.
    pins: [{ name: '1', dx: 0, dy: 0, electrical: false }],
    body: { shape: 'hole', radius: 1.4 },
  },
};

export function getPart(id) {
  const p = PARTS[id];
  if (!p) throw new Error(`unknown part: ${id}`);
  return p;
}

export function hasPart(id) {
  return Object.prototype.hasOwnProperty.call(PARTS, id);
}

// Which side of the board a part is mounted on. Through-hole parts sit on top
// and occupy their holes; a copper-side part is soldered to the track underneath
// and leaves the hole free.
// WHICH SIDE OF THE BOARD, and WHETHER IT IS SURFACE-MOUNT — two facts that used
// to be one field. See docs/specs/switchable-side.md.
//
// Peter: "an item / component / object needs to be able to switch layer but
// have a default layer, mostly top." So the SIDE belongs to the placement, and
// the part only supplies the default.
//
// Surface-mount does not move with it. `part.side` also meant "its pads are
// soldered to the track and never enter a hole", and every hole-occupancy check
// read it that way. A DIP flipped to the copper side still pushes its legs
// through holes; an 0603 lifted to the top is still a chip with no leads. So
// occupancy asks isSurfaceMount — the part's fact — and only the drawing asks
// which side a placement is on.
export const SIDES = ['top', 'copper'];
export const sideOf = (part, placement = null) => placement?.side ?? part?.side ?? 'top';
export const isSurfaceMount = (part) => (part?.side ?? 'top') === 'copper';
export const occupiesHoles = (part) => !isSurfaceMount(part);

// How this device's strips get cut: with a knife between two holes, or with a
// spot-face cutter at one. Declared rather than inferred from pin spacing —
// inferring would give the right answer for both parts in the library today, but
// would mean a part could never ask for a knife cut where a hole happens to be
// available, and the person who knows which tool they are picking up is the one
// holding it.
export const breakTypeOf = (part) => part.breakType ?? 'knife';

// The rotation a part should be placed at. A wire link declares 90 because a
// link ALONG a strip joins a segment to itself and does nothing — the DRC calls
// it redundant. Across the strips is the only orientation in which a link is a
// link, so it should not be the one you have to remember to ask for.
// THE ROTATION A PART IS PLACED AT, derived from which way its pins run.
//
// Peter: "90% of lib items I add and out by 90/270 degrees. each lib item needs
// to somehow identify it's pin -> strip orientation." Every part defines its
// pins along a row, so at 0 pins 1 and 2 share a strip, and only the wire link
// said otherwise, with a typed 90.
//
// So a part declares `pinsRun` — `across` (each pin on its own strip), `along`
// (the pins share a strip on purpose, which is then cut), or `either` (an 0603,
// built both ways) — and this returns the first quarter turn at which pins 1
// and 2 agree with it. Computed from the pins rather than looked up, so a part
// whose pins run down a column gets the right answer without anyone knowing.
// Strips run along rows. `either` places at 0, as it always has.
//
// `pinsRun` may be given to override the part's own — a device that says so.
export const PINS_RUN = ['across', 'along', 'either'];

export function defaultRotOf(part, pinsRun = part?.pinsRun) {
  if (pinsRun !== 'across' && pinsRun !== 'along') return 0;
  const pins = pinsOf(part).filter((p) => p.electrical !== false);
  if (pins.length < 2) return 0;
  const [a, b] = pins;
  for (const rot of [0, 90, 180, 270]) {
    // The same quarter turn resolvePins applies: (dx, dy) -> (-dy, dx) per 90.
    const turn = (x, y) => (rot === 0 ? [x, y] : rot === 90 ? [-y, x] : rot === 180 ? [-x, -y] : [y, -x]);
    const sameRow = turn(a.dx, a.dy)[1] === turn(b.dx, b.dy)[1];
    if (sameRow === (pinsRun === 'along')) return rot;
  }
  return 0;
}

// Which way a PLACEMENT's pins are meant to run: its own word, or its part's.
export const pinsRunOf = (placement, part) => placement?.pinsRun ?? part?.pinsRun ?? null;

// Which tool choosing this part arms. Everything places; point to point wires.
// The single way anything names a pin.
//
// It exists now, while there are few callers, because the component library
// coming later brings devices whose pins have real names — STEP, DIR, EN — and
// every message that says "pin 5" has to be able to say "pin STEP" instead
// without each one being found and changed.
export function pinLabel(part, index, span, width) {
  const pins = pinsOf(part, span, width);
  return pins[index]?.name ?? String(index + 1);
}

export const placesWith = (part) => part.places ?? 'place';
export const isWireOnly = (part) => placesWith(part) === 'wire';

// Resolve a part's pins. `pins` is either a static array whose dx/dy may be the
// literal string "span" or "width", or a generator taking (span, width).
export function pinsOf(part, span, width) {
  const n = span ?? part.defaultSpan;
  const wd = width ?? part.defaultWidth;
  if (typeof part.pins === 'function') return part.pins(n, wd);
  const resolve = (v) => (v === 'span' ? n : (v === 'width' ? wd : v));
  return part.pins.map((pin) => ({
    ...pin,
    dx: resolve(pin.dx),
    dy: resolve(pin.dy),
  }));
}

export function partList() {
  return Object.values(PARTS).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    kind: p.kind,
    side: sideOf(p),
    requiresBreak: !!p.requiresBreak,
    pinsRun: p.pinsRun ?? null,
    parametric: p.parametric,
    spanLabel: p.spanLabel ?? null,
    defaultSpan: p.defaultSpan ?? null,
    minSpan: p.minSpan ?? null,
    widthLabel: p.widthLabel ?? null,
    defaultWidth: p.defaultWidth ?? null,
    minWidth: p.minWidth ?? null,
  }));
}
