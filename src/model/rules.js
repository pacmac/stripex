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
import { getPart, isSurfaceMount, pinsOf } from '../parts/library.js';
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

// WHAT EACH RULE IS, IN ONE LIST, BESIDE THE RULE ITSELF.
//
// Peter: "this list will grow so it needs to be configurable." Three checkboxes
// typed into index.html would satisfy today's three and would have to be typed
// again for the fourth — two lists that must agree with nothing checking that
// they do, which is the shape that already shipped a part called "X1" and a
// palette that disagreed with the armed tool.
//
// So the Rules card is RENDERED FROM THIS. Adding a rule here gives it a control
// and costs no edit anywhere else, and a check asserts the two cannot drift.
//
// `id` is a dotted path into the rule set, so netClasses.power is addressable
// without the panel knowing that netClasses is a nested object.
export const RULE_DEFS = [
  {
    id: 'linksAreStraight',
    kind: 'boolean',
    label: 'Wire links are straight',
    help: 'A link runs along a strip or across it, never diagonally.',
    // Deliberately has no checker — see the note where the other two are checked.
    enforcedBy: 'ops.addLink',
  },
  {
    id: 'penWiresFreeHolesOnly',
    kind: 'boolean',
    label: 'Point to point is hole to hole',
    help: 'A pen wire ends in a free hole, never one that already has a pin in it.',
    enforcedBy: 'ops.addWire',
  },
  {
    id: 'penWiresSignalsOnly',
    kind: 'boolean',
    label: 'Power goes by wire link',
    help: 'Point to point is for signals. Refused over the API; warned at the mouse, '
      + 'because a rule that makes an existing board unusable is a rule nobody keeps.',
    enforcedBy: 'ops.addWire',
    warnsOnly: 'editor',
  },
  {
    id: 'netClasses.power',
    kind: 'patterns',
    label: 'Power net names',
    help: 'A net whose name matches one of these is power. Case is ignored.',
    enforcedBy: 'netClassOf',
  },
];

const byId = (id) => RULE_DEFS.find((d) => d.id === id) ?? null;

// The rules a given caller WARNS about rather than refuses.
//
// Derived from the definitions rather than typed at the call site, so the split
// is declared once beside the rule it belongs to. It was a literal list in
// app.js — a second statement of which rules are advisory, free to disagree with
// the first.
export const warnOnlyFor = (who) => RULE_DEFS
  .filter((d) => d.warnsOnly === who).map((d) => d.id);

// A dotted path in, the value out, without the caller knowing the shape.
export function ruleValue(rules, id) {
  return String(id).split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), rules);
}

// The rules in force for a board: its own, over the defaults. `netClasses` is
// REPLACED rather than merged — a board that redefines what counts as power
// means it, and quietly keeping the old patterns underneath would make the
// override untestable.
export function rulesFor(project) {
  return { ...DEFAULT_RULES, ...(project?.rules ?? {}) };
}

// A rule that is OFF, said out loud.
//
// A constraint switched off six weeks ago is how a board gets built wrong by
// someone who believes they are protected. Only boolean rules can be "off"; a
// pattern list that has been edited is a different thing and is not a warning.
export function disabledRuleNotes(project) {
  const rules = rulesFor(project);
  const out = [];
  for (const def of RULE_DEFS) {
    if (def.kind !== 'boolean') continue;
    if (ruleValue(rules, def.id) === false) {
      out.push({
        severity: 'warning',
        code: 'rule-disabled',
        message: `${def.label} is switched off for this board — ${def.id}`,
        refs: [def.id],
        holes: [],
      });
    }
  }
  return out;
}

// What is wrong with a proposed change to the rules, or null.
//
// SEPARATE FROM ops.setRules so the panel can say it before the write is
// attempted, and so the reason is one sentence rather than a thrown error.
export function validateRulePatch(patch) {
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === 'netClasses') {
      for (const [cls, list] of Object.entries(value ?? {})) {
        const def = byId(`netClasses.${cls}`);
        if (!def) return `${JSON.stringify(`netClasses.${cls}`)} is not a rule`;
        if (!Array.isArray(list)) return `netClasses.${cls} must be a list of patterns`;
        for (const pattern of list) {
          // A bad regex is swallowed at match time, so a stored one is a rule
          // that silently never fires. The door is the only place it can still
          // be reported to whoever typed it.
          try { new RegExp(pattern, 'i'); } catch (e) {
            return `${JSON.stringify(pattern)} is not a usable pattern: ${e.message}`;
          }
        }
      }
      continue;
    }
    const def = byId(key);
    if (!def) return `${JSON.stringify(key)} is not a rule`;
    if (def.kind === 'boolean' && typeof value !== 'boolean') {
      return `${key} is on or off, not ${JSON.stringify(value)}`;
    }
  }
  return null;
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
  // Surface-mount is the part's fact, not the placement's side: a DIP moved to
  // the copper side still fills its holes. See switchable-side.md.
  const surfaceRefs = new Set();
  for (const pl of placements) {
    try { if (isSurfaceMount(getPart(pl.part))) surfaceRefs.add(pl.ref); } catch { /* unknown part */ }
  }
  const pinAt = new Map();
  for (const p of pins) {
    if (surfaceRefs.has(p.ref)) continue;
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

  // --- a polarised part the wrong way round, judged by net names ----------
  //
  // The LED on the first 555 board went in backwards and only reading which net
  // each pin landed on caught it: a netlist states connectivity, not direction.
  // Potential is not in the model, but some NAMES settle it — a positive pin on
  // 0V or GND, or a negative pin on VCC or +5V, is the wrong way round. A
  // warning, because it is inferred from a name, and silent on an unnamed net.
  // See docs/specs/polarity-by-net-name.md.
  {
    const POSITIVE = new Set(['+', 'A']);
    const NEGATIVE = new Set(['-', 'K']);
    const GROUND = /^(0V|GND\d*|[AD]GND|VSS)$/i;
    let segmentNet = null;
    let labels = null;
    const namesAt = (p) => {
      if (!segmentNet) {
        ({ segmentNet } = netsOf(project, segs));
        labels = netLabelsAllByNet(project, segmentNet);
      }
      const segId = idx.get(holeKey(p.col, p.row));
      const netId = segId && segmentNet[segId];
      return netId ? (labels.get(netId) ?? []).map((l) => l.name).filter(Boolean) : [];
    };
    for (const pl of placements) {
      let part;
      try { part = getPart(pl.part); } catch { continue; }
      // By the PART's own pin names, not a device's renamed ones.
      const own = pinsOf(part, pl.span, pl.width);
      if (!own.some((q) => POSITIVE.has(q.name)) || !own.some((q) => NEGATIVE.has(q.name))) continue;
      const placed = pins.filter((q) => q.ref === pl.ref);
      own.forEach((q, i) => {
        const at = placed[i];
        if (!at) return;
        for (const name of namesAt(at)) {
          const ground = GROUND.test(name);
          const supply = !ground && netClassOf(name, rules) === 'power';
          const wrong = (POSITIVE.has(q.name) && ground) || (NEGATIVE.has(q.name) && supply);
          if (!wrong) continue;
          out.push(finding('warning', 'polarity-reversed',
            `${pl.ref} has its ${q.name === 'A' ? 'anode' : q.name === 'K' ? 'cathode' : q.name} `
            + `on ${name}, which by its name is ${ground ? 'ground' : 'a supply'} — `
            + 'it looks the wrong way round',
            [pl.ref], [{ col: at.col, row: at.row }]));
          break;
        }
      });
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
