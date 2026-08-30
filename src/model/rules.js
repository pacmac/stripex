// The design rules, as data the BOARD carries.
//
// Peter, 2026-08-30: "wire links can only be straight, point to point can be
// anywhere for signals only. power lines must be wire links, and probably laid
// in first", and later "point to point must be hole to hole and not hole with
// pin already in it to another hole."
//
// WHY THEY ARE HERE AND NOT IN A DOCUMENT. They were in a document — I wrote
// them into docs/specs/architecture-for-netlist.md myself — and then broke two
// of them wiring his rotator board, while the DRC reported zero errors. A rule
// that lives in prose binds nobody. This module is the difference between
// having agreed something and enforcing it.
//
// IN THE PROJECT, NOT BESIDE THE APPLICATION. A saved board must reproduce its
// own findings: rules kept next to the editor would mean opening an old board on
// a differently configured machine reports different errors about identical
// copper. That is the same coupling as a placement referencing a catalogue
// entry, which this project has already lost a board to.

import { segments, segmentIndex, holeKey } from '../net/segments.js';
import { effectiveBreaks } from './breaks.js';
import { resolvePins } from './rotate.js';
import { getPart, sideOf } from '../parts/library.js';
import { netLabelsAllByNet } from './nets.js';
import { nets as deriveNets } from '../net/derive.js';

// A net's class is read from its NAME, because that is the only thing that
// knows. The patterns are part of the rule set rather than of this file, so the
// day somebody calls a rail RAW it is an edit and not a release.
export const DEFAULT_RULES = {
  // A link is a straight piece of wire between two holes.
  linksAreStraight: true,
  // A pen wire ends in a hole with nothing already in it.
  penWiresFreeHolesOnly: true,
  // Point to point is for signals. Power goes by link.
  penWiresSignalsOnly: true,
  netClasses: {
    power: [
      '^0V$', '^GND\\d*$', '^[AD]GND$', '^VSS$', '^VCC$', '^VDD$', '^VIN$',
      '^VBUS$', '^VUSB$', '^VMOT$', '^VM$', '^VIO$', '^VREF$',
      '^\\+?\\d+V\\d*$', '^\\d+V\\d+$',
    ],
  },
};

// The rules in force for a board: its own, over the defaults. `netClasses` is
// REPLACED rather than merged — a board that redefines what counts as power
// means it, and quietly keeping the old patterns underneath would make the
// override untestable.
export function rulesFor(project) {
  return { ...DEFAULT_RULES, ...(project?.rules ?? {}) };
}

export function netClassOf(name, rules = DEFAULT_RULES) {
  const n = String(name ?? '').trim();
  if (!n) return 'signal';
  for (const pattern of rules.netClasses?.power ?? []) {
    try { if (new RegExp(pattern, 'i').test(n)) return 'power'; } catch { /* a bad pattern is not a crash */ }
  }
  return 'signal';
}

const finding = (severity, code, message, refs = [], holes = []) =>
  ({ severity, code, message, refs, holes });

// Findings in the DRC's shape, so the Checks tab shows them without learning a
// second format.
export function checkRules(project) {
  const rules = rulesFor(project);
  const out = [];
  if (!project?.board) return out;

  let segs;
  try { segs = segments(project.board, effectiveBreaks(project)); } catch { return out; }
  const idx = segmentIndex(segs);
  const placements = project.placements ?? [];
  const wires = project.wires ?? [];

  let pins = [];
  try { pins = resolvePins(placements, getPart); } catch { /* the DRC reports this */ }

  // A copper-side pad is soldered to the track underneath and never enters the
  // hole, so it does not occupy one — the same exclusion the DRC already makes.
  const sideByRef = new Map();
  for (const pl of placements) {
    try { sideByRef.set(pl.ref, sideOf(getPart(pl.part))); } catch { /* unknown part */ }
  }
  const pinAt = new Map();
  for (const p of pins) {
    if (sideByRef.get(p.ref) === 'copper') continue;
    pinAt.set(holeKey(p.col, p.row), `${p.ref}.${p.pin}`);
  }

  // --- a pen wire ends in a hole that has a pin in it ----------------------
  //
  // Nine of my ten endpoints did this on Peter's board. The DRC's own source
  // documents the OPPOSITE — "a pen wire is soldered to the joint a component
  // lead already occupies" — which is why nothing caught it. His practice is
  // hole to hole, and his board is the one being built.
  if (rules.penWiresFreeHolesOnly) {
    for (const w of wires) {
      for (const [end, h] of [['from', w.from], ['to', w.to]]) {
        if (!h) continue;
        const occupant = pinAt.get(holeKey(h.col, h.row));
        if (!occupant) continue;
        out.push(finding('error', 'pen-wire-on-a-pin',
          `${w.ref} ends at (${h.col},${h.row}), where ${occupant} already is — `
          + 'a pen wire goes hole to hole',
          [w.ref], [{ col: h.col, row: h.row }]));
        void end;
      }
    }
  }

  // --- a pen wire on a power net ------------------------------------------
  if (rules.penWiresSignalsOnly && wires.length) {
    const { segmentNet } = netsOf(project, segs);
    const labels = netLabelsAllByNet(project, segmentNet);
    const nameOfNet = (netId) => (labels.get(netId) ?? [])
      .map((l) => l.name).filter(Boolean);
    for (const w of wires) {
      for (const h of [w.from, w.to]) {
        if (!h) continue;
        const segId = idx.get(holeKey(h.col, h.row));
        const netId = segId && segmentNet[segId];
        if (!netId) continue;
        const power = nameOfNet(netId).find((nm) => netClassOf(nm, rules) === 'power');
        if (!power) continue;
        out.push(finding('error', 'pen-wire-on-power',
          `${w.ref} touches ${power}, a power net, at (${h.col},${h.row}) — `
          + 'power goes by wire link, not point to point',
          [w.ref], [{ col: h.col, row: h.row }]));
      }
    }
  }

  // --- `linksAreStraight` IS NOT CHECKED HERE, DELIBERATELY -----------------
  //
  // A link's pins are collinear in the library and a rotation is one of four
  // right angles, so no PLACEMENT can produce a diagonal link. A checker for it
  // would be code that can never fire, which is worse than no checker because it
  // reads as protection.
  //
  // The rule is enforced where it can actually be broken: ops.addLink refuses
  // two holes that are not in line, which is exactly the request I made when I
  // put a link's end on the wrong strip.

  return out;
}

// Derived here rather than imported from the renderer, so this module stays in
// the model. Same reason nets.js does it.
function netsOf(project, segs) {
  const pins = resolvePins(project.placements ?? [], getPart);
  return deriveNets(segs, pins, project.placements ?? [], getPart, project.wires ?? []);
}
