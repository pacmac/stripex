// Named devices — TMC2209, XIAO, and whatever else the component library grows
// to hold.
//
// A DEVICE IS A PRESET OVER A GENERIC FOOTPRINT. Peter built one by hand before
// this file existed: his TMC2209 was a `dip` with span 8, width 5, a green silk
// colour and autoBreak off. That is exactly what a device is, so adding one is
// adding a record — no geometry, no rendering, no new code path. That is what
// "plan for the library" has to mean if it is to still be true later.
//
// THE RULE THAT MATTERS MOST:
//
//   A PLACEMENT OWES THE CATALOGUE NOTHING.
//
// Placing a device copies its parameters and its pin names ONTO the placement
// and tags it with the device id for display only. Nothing downstream — not the
// renderer, not the DRC, not the netlist — ever looks a device up.
//
// If a placement merely referenced a device id, then editing or deleting a
// catalogue entry would silently change or break every board that used it. A
// board was already lost in this project to exactly that shape: a rule added
// after the fact, changing the meaning of data that was valid when it was
// written. Not again.

import { getPart, hasPart, PINS_RUN } from './library.js';
import { resolvePins } from '../model/rotate.js';

// PIN NUMBERING, EVERYWHERE HERE: down one side, then back up the other, which
// is what `dipPins` does and what a DIL package does. So `pins[0]` is pin 1 at
// the top of the first row and `pins[span]` is the pin diagonally opposite it,
// at the BOTTOM of the second row.
//
// `unverifiedPins` is a LIST OF PIN NAMES, not a flag on the device. A whole-
// device boolean forces a choice between marking fourteen sourced names as
// doubtful or marking two guessed ones as fact, and both are lies. Name the pins
// you could not source, and the rest stand.
//
// `pinSource` says WHERE THE NAMES CAME FROM, in one line. A name with no
// provenance is a name nobody can check — the difference between "read off a
// v2.0 board file in pad order" and "I typed it" is invisible in the data and
// decisive at the bench.

export const DEVICES = {
  // ------------------------------------------------------------------ XIAO
  //
  // 7 pads a side at 2.54 mm, rows 15.24 mm apart = 6 holes; board 21 x 17.8 mm.
  // The same footprint across the whole XIAO family — SAMD21, RP2040, ESP32-C3,
  // nRF52840 — which is the point of the form factor, so one entry serves all of
  // them.
  //
  // The order below is the board's own, and it already runs down one side and
  // back up the other, so it maps onto this project's numbering unchanged.
  //
  // NO ALTERNATE FUNCTIONS IN THE NAMES. D4 is what the silkscreen says; SDA is
  // a property of the net that lands on it, and Peter's board already writes
  // SDA where it belongs — on the net.
  xiao: {
    id: 'xiao',
    name: 'Seeed XIAO',
    category: 'module',
    base: 'dip',
    pinSource: 'Seeed XIAO silkscreen; the form factor is shared across the family',
    span: 7,
    width: 6,
    silk: '#1971c2',
    autoBreak: false,
    refPrefix: 'U',
    pins: [
      // left, top down
      'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6',
      // right, bottom up
      'D7', 'D8', 'D9', 'D10', '3V3', 'GND', '5V',
    ],
  },

  // -------------------------------------------------------------- TMC2209
  //
  // Its span, width, silk and autoBreak are PETER'S OWN, read off the board he
  // drew. The width is corroborated: a board file for the SilentStepStick v2.0
  // puts its two headers at x=142.1511 and x=154.8511, which is 12.7 mm apart —
  // 5 holes, exactly what he used.
  //
  // The names come from that same file's nets, in pad order:
  //   one column   DIR STEP (pad3) (pad4) SPREAD MS2 MS1 EN
  //   the other    VM GND OA2 OA1 OB1 OB2 VIO GND
  //
  // The motor outputs are written in the M-naming PETER USES — his own net
  // labels are M1A M1B M2A M2B — mapped through the A4988-compatible positions
  // those pads occupy: OA2->M2B, OA1->M2A, OB1->M1A, OB2->M1B.
  //
  // Both grounds are on the second column and a netlist has to tell them apart,
  // so they are GND and GNDM — the one beside VM is the motor ground.
  //
  // PADS 3 AND 4 ARE UNROUTED IN THAT SOURCE. They are the positions an A4988
  // uses for SLP and RST. Named NC3 and NC4 and listed below as the only two
  // names here that are not traceable to anything.
  //
  // I WENT TO VERIFY THEM ON 2026-08-30 AND COULD NOT, which is why they are
  // still called that:
  //
  //   - Watterott's own pin-config page for this module has NO PIN CALLED CLK
  //     and does not name the A4988 RST/SLP positions at all.
  //   - RepRap's TMC2209 page carries pinouts for six different modules —
  //     Watterott, Panucatt, BTT, Fysetec, Lerdge, makerbase — and states that
  //     DIAG, INDEX and VREF are THE PINS MOST LIKELY TO DIFFER between them.
  //
  // The two unknown positions are precisely the ones the sources say vary by
  // manufacturer. So there is no correct answer to "what is pin 3" — only "what
  // is pin 3 on the module Peter has", and no amount of reading settles that.
  // Clearing the flag from a page describing a different module would convert an
  // honest unknown into a confident error on a board somebody solders.
  //
  // Peter's own net names under this chip read DIR CLK URT PDN MS2 MS1 EN down
  // the column, which is a third reading again — though his placement is a bare
  // `dip` with no pin names, so the two have never actually been compared.
  //
  // ops.setPinNames is how his answer becomes part of a board when he gives it.
  tmc2209: {
    id: 'tmc2209',
    name: 'TMC2209 SilentStepStick',
    category: 'module',
    base: 'dip',
    span: 8,
    width: 5,
    silk: '#2f9e44',
    autoBreak: false,
    refPrefix: 'U',
    pinSource: 'SilentStepStick v2.0 board file, nets in pad order — except NC3/NC4, '
      + 'which are unrouted there and vary by manufacturer',
    unverifiedPins: ['NC3', 'NC4'],
    pins: [
      // one column, top down
      'DIR', 'STEP', 'NC3', 'NC4', 'SPREAD', 'MS2', 'MS1', 'EN',
      // the other, bottom up — so GND (beside VIO) is pin 9
      'GND', 'VIO', 'M1B', 'M1A', 'M2A', 'M2B', 'GNDM', 'VM',
    ],
  },

  // A SOT-23 MOSFET. Peter: "I believe most share the same GDS pins ?" — they
  // do: 1 G, 2 S, 3 D is the pinout of the common ones named below. It is a
  // MOSFET device rather than the package's own names because the package is
  // shared with BJTs (1 B, 2 E, 3 C) and JFETs, which do not follow it.
  //
  // On stripboard G and S share a strip, so the derived knife cut is what keeps
  // them apart. A deliberate gate-to-source tie is that cut left out.
  'sot23-mosfet': {
    id: 'sot23-mosfet',
    name: 'SOT-23 MOSFET',
    category: 'semiconductor',
    base: 'sot23',
    refPrefix: 'Q',
    pinSource: 'the common SOT-23 MOSFET pinout: 2N7002, BSS138, AO3400/AO3401, Si2302 — '
      + 'check a part outside that list against its own datasheet',
    pins: ['G', 'S', 'D'],
  },

  ...jstFamily(),
};

// ------------------------------------------------------------- JST XH
//
// XH IS 2.5 mm PITCH AND THIS BOARD IS 2.54 mm. Over 8 ways that is 0.28 mm of
// accumulated error, under half a hole, so it solders in — but it is a real
// difference and belongs in the name rather than hidden. The footprint is
// modelled at the BOARD's pitch, because that is where the holes are.
//
// Straight and right-angle are SEPARATE DEVICES, not a parameter. They are
// different things to place: the right-angle's body lies over the board on one
// side of its pins, and which side is a placement decision, not a detail.
//
// Pins are numbered 1..n from the end the connector's own numbering starts, and
// named by number — a connector's pins have no function of their own, they have
// whatever the cable brings.
function jstFamily() {
  const out = {};
  for (const ways of [2, 3, 4, 5, 6, 7, 8]) {
    for (const angle of ['straight', 'right']) {
      const id = `jst-xh-${ways}-${angle}`;
      out[id] = {
        id,
        name: `JST XH ${ways}-way ${angle === 'right' ? 'right angle' : 'straight'}`,
        category: 'connector',
        base: 'jst-xh',
        span: ways,
        ways,
        angle,
        refPrefix: 'J',
        pinSource: 'the connector\'s own numbering — a JST pin has no function of its own',
        pins: Array.from({ length: ways }, (_, i) => String(i + 1)),
      };
    }
  }
  return out;
}

// ------------------------------------------------------------ the overlay
//
// THE BUILT-INS ABOVE ARE THE DEFAULTS AND STAY IN CODE. A fresh install is a
// complete catalogue with no file anywhere, and what gets stored is only what
// Peter has ADDED or CHANGED — which is also what makes the stored file worth
// reading.
//
// Peter, 2026-08-31: "next task is a component editor screen". Every component
// problem this week needed me to edit this file: the JST body was the wrong size
// twice, NC3 and NC4 are two names only his silkscreen can settle, and his SMT
// parts want a 1206 land that is not here. He is holding the part.
//
// SYNCHRONOUS ON PURPOSE. getDevice is called straight from ops.addPart,
// placementFor, the netlist parser and the editor's palette; making the
// catalogue async would reach all four and turn a data change into a
// control-flow change.
let overlay = {};

const isSlug = (s) => /^[a-z0-9][a-z0-9_-]*$/.test(String(s ?? ''));

// What is wrong with a device, or null. Checked at the door because a bad device
// is a board that cannot be drawn, and the error has to reach whoever typed it.
export function validateDevice(d) {
  if (!d || typeof d !== 'object') return 'a device is an object';
  if (!isSlug(d.id)) return `${JSON.stringify(d.id)} is not a usable id — lower case, no spaces`;
  if (!d.name) return `${d.id} has no name`;
  if (!hasPart(d.base)) return `${JSON.stringify(d.base)} is not a part this can be built on`;

  for (const key of ['span', 'width']) {
    if (d[key] == null) continue;
    if (!Number.isInteger(d[key]) || d[key] < 1) {
      return `${d.id}: ${key} is ${JSON.stringify(d[key])}, and must be a whole number of holes`;
    }
  }

  // Which way its pins cross the strips, when it differs from its base part's.
  // Absent means "as the base says". See docs/specs/pins-run-across-strips.md.
  if (d.pinsRun != null && !PINS_RUN.includes(d.pinsRun)) {
    return `${d.id}: pinsRun is ${JSON.stringify(d.pinsRun)}, and must be one of ${PINS_RUN.map((v) => `"${v}"`).join(', ')}`;
  }

  const pins = d.pins ?? [];
  if (!Array.isArray(pins) || !pins.length) return `${d.id} has no pins`;
  const seen = new Set();
  for (const [i, name] of pins.entries()) {
    if (!String(name ?? '').trim()) return `${d.id}: pin ${i + 1} has a blank name`;
    if (seen.has(name)) return `${d.id}: the name ${JSON.stringify(name)} is used twice`;
    seen.add(name);
  }

  // The names have to match the footprint, or every name after the mismatch is
  // confidently wrong — the same reason adoptDevice refuses.
  const probe = { ref: 'X1', part: d.base, at: { col: 0, row: 0 }, rot: 0 };
  if (d.span != null) probe.span = d.span;
  if (d.width != null) probe.width = d.width;
  let count = 0;
  try { count = resolvePins([probe], getPart).length; } catch { /* the base reports it */ }
  if (count && count !== pins.length) {
    return `${d.id}: that footprint has ${count} pins and ${pins.length} names were given`;
  }

  for (const name of d.unverifiedPins ?? []) {
    if (!pins.includes(name)) return `${d.id}: ${JSON.stringify(name)} is flagged unverified and is not one of its pins`;
  }
  return null;
}

// Install the stored set over the built-ins. ALL OR NOTHING: a batch with one
// bad device changes nothing, because a half-installed catalogue is a catalogue
// nobody can reason about.
export function installDevices(list = []) {
  const next = {};
  for (const d of list) {
    const bad = validateDevice(d);
    if (bad) return { error: bad };
    next[d.id] = { ...d };
  }
  overlay = next;
  return { devices: deviceList() };
}

// Everything stored, for writing back out.
export const storedDevices = () => Object.values(overlay).map((d) => ({ ...d }));

const allDevices = () => ({ ...DEVICES, ...overlay });

export const getDevice = (id) => allDevices()[id] ?? null;

export const isBuiltIn = (id) => Boolean(DEVICES[id]) && !overlay[id];

export function deviceList() {
  return Object.values(allDevices()).map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    base: d.base,
    pins: d.pins?.length ?? 0,
    // WHICH pins, not whether. A palette that can only say "something here is
    // doubtful" sends you to the source file to find out what.
    unverifiedPins: [...(d.unverifiedPins ?? [])],
    // So a screen can offer "back to stock" honestly, and only where there is
    // a stock version to go back to.
    builtIn: isBuiltIn(d.id),
  }));
}

// The placement a device becomes. Everything the board needs is copied in;
// `device` is a label, not a link.
export function placementFor(deviceId, at, rot = 0, ref = null) {
  const d = getDevice(deviceId);
  if (!d || !hasPart(d.base)) return null;
  const pl = {
    ref: ref ?? `${d.refPrefix ?? getPart(d.base).refPrefix ?? 'U'}1`,
    part: d.base,
    at: { ...at },
    rot,
    device: d.id,
  };
  if (d.span != null) pl.span = d.span;
  if (d.width != null) pl.width = d.width;
  if (d.silk) pl.silk = d.silk;
  if (d.autoBreak != null) pl.autoBreak = d.autoBreak;
  // Only an OVERRIDE is copied: a device that says nothing leaves the placement
  // to its part, so correcting a part's declaration corrects its devices too.
  if (d.pinsRun != null) pl.pinsRun = d.pinsRun;
  // Which way a shrouded connector faces is a property of the thing on the
  // board, not of the catalogue it came from — so it is copied like everything
  // else here, and the drawing reads it off the placement.
  if (d.angle) pl.angle = d.angle;
  // Copied, not referenced — see the rule at the top of this file.
  if (d.pins?.length) pl.pinNames = [...d.pins];
  // THE DOUBT TRAVELS WITH THE NAMES. The board is drawn from the placement, so
  // a flag left behind in the catalogue is a flag the board cannot show, and the
  // only place the uncertainty would exist is a field nobody opens.
  if (d.unverifiedPins?.length) pl.unverifiedPins = [...d.unverifiedPins];
  if (d.pinSource) pl.pinSource = d.pinSource;
  return pl;
}
