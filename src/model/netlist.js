// A netlist: what the board is SUPPOSED to connect, and what it actually does.
//
// Peter, 2026-08-30: "a BIG one, creating of a new design from a netlist. I dont
// think that can be done by a script and would effectively be a claude
// interractive script that will allow you to build a real board."
//
// INTERACTIVE IS THE REQUIREMENT, NOT A CONCESSION. An autorouter that places
// and wires a whole board unattended is not what was asked for and is not what
// would be trusted. What is asked for is a loop: state the intent, see what the
// board does and does not yet satisfy, propose the next moves, apply the ones
// that are right. So this module reads, compares and PROPOSES. It never decides.
//
// It exists because when v5 sent a netlist I compared it to Peter's board by
// hand, three times, in throwaway scripts — which is how nine pen-wire ends came
// to sit on pins and how I told him 0V and 3V3 were shorted when they were not.
// Every one of those was a comparison a program should have been doing.

import { getDevice } from '../parts/devices.js';
import { getPart } from '../parts/library.js';
import { resolvePins } from './rotate.js';
import { segments, segmentIndex, holeKey } from '../net/segments.js';
import { effectiveBreaks } from './breaks.js';
import { netsFor } from './views.js';
// The one that was written three times in scratch scripts and wrong twice. There
// is not going to be a fourth version of it living here.
import { freeHolesOn } from './ops.js';
import { rulesFor, netClassOf } from './rules.js';

// --------------------------------------------------------------- parsing

const isRef = (s) => /^[A-Za-z][A-Za-z0-9_]*$/.test(s);

// `REF.PIN` — the dot is the LAST one, because a pin may legitimately contain
// one and a ref may not.
function splitPin(token) {
  const i = String(token).lastIndexOf('.');
  if (i <= 0 || i === token.length - 1) return null;
  return { ref: token.slice(0, i), pin: token.slice(i + 1) };
}

// Text in, `{parts, nets, problems}` out.
//
// A BAD LINE IS REPORTED, NEVER DROPPED. A netlist that quietly says less than
// its author wrote produces a board that satisfies it while missing a
// connection — the failure mode with no symptom until the thing is built.
export function parseNetlist(input) {
  if (input && typeof input === 'object') {
    const parts = { ...(input.parts ?? {}) };
    const nets = {};
    for (const [name, pins] of Object.entries(input.nets ?? {})) nets[name] = [...pins];
    return validateNames({ parts, nets, problems: [] });
  }

  const parts = {};
  const nets = {};
  const problems = [];
  const lines = String(input ?? '').split('\n');

  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [word, ...rest] = line.split(/\s+/);
    const kind = word.toLowerCase();

    if (kind === 'part') {
      const [ref, device] = rest;
      if (!ref || !device) {
        problems.push({ line: i + 1, message: `${JSON.stringify(line)} — a part line is "part <ref> <device>"` });
        continue;
      }
      if (!isRef(ref)) {
        problems.push({ line: i + 1, message: `${JSON.stringify(ref)} is not a usable reference` });
        continue;
      }
      parts[ref] = device;
      continue;
    }

    if (kind === 'net') {
      const [name, ...pins] = rest;
      if (!name) {
        problems.push({ line: i + 1, message: `${JSON.stringify(line)} — a net line is "net <name> <ref.pin>..."` });
        continue;
      }
      // Repeated `net` lines for one name MERGE, so a long net can be written
      // across several lines the way a person would write it.
      nets[name] = [...(nets[name] ?? []), ...pins];
      continue;
    }

    problems.push({
      line: i + 1,
      message: `${JSON.stringify(line)} is neither a part nor a net — lines start with "part" or "net"`,
    });
  }

  return validateNames({ parts, nets, problems });
}

// Every pin token checked against the device that owns it.
//
// A PIN IS NAMED, NEVER NUMBERED, for the reason device-aware-api.md gives: a
// caller who has to count pins is a caller about to get one wrong. The refusal
// offers the real names, because "U1.4 is wrong" without them just sends
// somebody to read a source file.
function validateNames(nl) {
  for (const [name, pins] of Object.entries(nl.nets)) {
    for (const token of pins) {
      const split = splitPin(token);
      if (!split) {
        nl.problems.push({ line: null, message: `${JSON.stringify(token)} in net ${name} is not REF.PIN` });
        continue;
      }
      const deviceId = nl.parts[split.ref];
      if (!deviceId) continue;                 // an unknown part is compareToNetlist's to report
      const d = getDevice(deviceId);
      if (!d) {
        nl.problems.push({ line: null, message: `${split.ref} is a ${JSON.stringify(deviceId)}, which is not a device` });
        continue;
      }
      if (d.pins?.length && !d.pins.includes(split.pin)) {
        nl.problems.push({
          line: null,
          message: `${token}: a ${d.name} has no pin ${JSON.stringify(split.pin)}. Its pins are ${d.pins.join(' ')}`,
        });
      }
    }
  }
  return nl;
}

// --------------------------------------------------------------- comparing

// Where every pin of every placement sits, keyed REF.PIN.
function pinHoles(project) {
  const out = new Map();
  let pins = [];
  try { pins = resolvePins(project.placements ?? [], getPart); } catch { return out; }
  for (const p of pins) out.set(`${p.ref}.${p.pin}`, { col: p.col, row: p.row });
  return out;
}

// The board net a hole is on, or null for a hole with no copper under it.
function netAtFor(project) {
  const segs = segments(project.board, effectiveBreaks(project));
  const idx = segmentIndex(segs);
  const { segmentNet } = netsFor(project);
  return (hole) => {
    if (!hole) return null;
    const segId = idx.get(holeKey(hole.col, hole.row));
    return segId ? (segmentNet[segId] ?? null) : null;
  };
}

// Does this board implement this netlist?
//
// THE SHORT CHECK COMES FIRST AND IS REPORTED FIRST. Two netlist nets landing on
// one board net is the fault that is invisible on a drawing and permanent on
// copper. A missing connection is work outstanding; a short is damage.
export function compareToNetlist(project, netlist) {
  const nl = (netlist && netlist.nets) ? netlist : parseNetlist(netlist);
  const holes = pinHoles(project);
  const netAt = netAtFor(project);

  const missing = [];
  const out = [];
  // boardNetId -> the netlist nets found sitting on it
  const occupants = new Map();

  for (const [name, tokens] of Object.entries(nl.nets)) {
    // pin -> board net, and the pins we could not place at all
    const groups = new Map();
    const absent = [];
    for (const token of tokens) {
      const hole = holes.get(token);
      if (!hole) {
        absent.push(token);
        missing.push({ pin: token, net: name, why: holes.size
          ? 'that pin is not on this board'
          : 'nothing is placed on this board yet' });
        continue;
      }
      const boardNet = netAt(hole);
      const key = boardNet ?? `dead:${hole.col},${hole.row}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(token);
      if (boardNet) {
        if (!occupants.has(boardNet)) occupants.set(boardNet, new Set());
        occupants.get(boardNet).add(name);
      }
    }

    const placed = [...groups.values()];
    const status = absent.length && !placed.length ? 'absent'
      : placed.length > 1 ? 'split'
        : placed.length === 1 && !absent.length ? 'satisfied'
          : 'split';

    out.push({ name, status, groups: placed, absent, want: tokens.length });
  }

  // A board net carrying more than one netlist net.
  const shorts = [];
  for (const [boardNet, names] of occupants) {
    if (names.size < 2) continue;
    const list = [...names].sort();
    shorts.push({
      boardNet,
      nets: list,
      message: `${list.join(' and ')} are on the same strip — that is a short, not a connection`,
    });
  }

  return {
    nets: out,
    shorts,
    missing,
    problems: nl.problems ?? [],
    satisfied: out.filter((n) => n.status === 'satisfied').length,
    total: out.length,
  };
}

// The same thing in the DRC's finding shape, so the Checks tab shows it without
// learning a second format.
export function netlistFindings(project, netlist) {
  const report = compareToNetlist(project, netlist);
  const out = [];
  for (const short of report.shorts) {
    out.push({ severity: 'error', code: 'netlist-short', message: short.message,
      refs: short.nets, holes: [] });
  }
  for (const net of report.nets) {
    if (net.status === 'satisfied') continue;
    const ends = net.groups.map((g) => g.join('+')).join(' | ');
    out.push({
      severity: 'warning',
      code: 'netlist-unmade',
      message: net.status === 'absent'
        ? `${net.name} is in the netlist and nothing on the board carries it`
        : `${net.name} is not joined up yet: ${ends}`,
      refs: [net.name],
      holes: [],
    });
  }
  for (const p of report.problems) {
    out.push({ severity: 'error', code: 'netlist-unreadable',
      message: p.line ? `line ${p.line}: ${p.message}` : p.message, refs: [], holes: [] });
  }
  return out;
}

// ---------------------------------------------------------------- planning

// What to do next, as ops — PROPOSED, not applied.
//
// It obeys the rules rather than restating them: the net's class decides whether
// a connection is a link or a pen wire, and where a rule cannot be honoured the
// connection is REFUSED WITH THE RULE NAMED rather than proposed as something
// applyOps would reject. A plan whose ops get refused on application is worse
// than no plan, because it looks like progress.
export function planFor(project, netlist) {
  const nl = (netlist && netlist.nets) ? netlist : parseNetlist(netlist);
  const rules = rulesFor(project);
  const report = compareToNetlist(project, nl);
  const holes = pinHoles(project);

  const ops = [];
  const refusals = [];
  const notes = [];
  const claimed = new Set();

  // POWER FIRST. Peter: "power lines must be wire links, and probably laid in
  // first." Laid in first because a link is straight and needs its lane, and a
  // signal wire that got there first takes the hole a link cannot go round.
  const byClass = (name) => netClassOf(name, rules);
  const order = [...report.nets].sort((a, b) => {
    const ap = byClass(a.name) === 'power' ? 0 : 1;
    const bp = byClass(b.name) === 'power' ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  });

  for (const net of order) {
    if (net.status === 'satisfied') continue;
    if (net.absent.length) {
      refusals.push({
        net: net.name,
        pins: net.absent,
        reason: `${net.absent.join(', ')} ${net.absent.length === 1 ? 'is' : 'are'} not on the board`,
      });
    }
    // Join each group to the first one: a net of n groups needs n-1 joins, and
    // fanning them all from one anchor keeps every added connection independent
    // of whether the others were applied.
    const [anchorGroup, ...rest] = net.groups;
    if (!anchorGroup || !rest.length) continue;
    const anchorPin = anchorGroup[0];
    const anchor = holes.get(anchorPin);
    const power = byClass(net.name) === 'power';

    for (const group of rest) {
      const pin = group[0];
      const at = holes.get(pin);
      if (!anchor || !at) continue;

      if (power) {
        // A link is straight, so it can only join holes that share a row or a
        // column. Anything else is a refusal naming the rule, not a diagonal.
        if (anchor.col !== at.col && anchor.row !== at.row) {
          refusals.push({
            net: net.name, rule: 'linksAreStraight', from: anchorPin, to: pin,
            reason: `${anchorPin} and ${pin} are not in line, and ${net.name} is power, `
              + 'so it goes by wire link — move one of them, or take it in two hops',
          });
          continue;
        }
        ops.push({
          op: 'addLink', net: net.name, from: anchor, to: at,
          why: `${net.name} is power, so ${anchorPin} to ${pin} is a wire link`,
        });
        continue;
      }

      // A SIGNAL GOES POINT TO POINT, HOLE TO HOLE. Never onto the pin itself:
      // that is the rule I broke nine times, and the free hole on the pin's own
      // strip is the endpoint it should always have had.
      const fromHole = rules.penWiresFreeHolesOnly
        ? freeHoleFor(project, anchorPin, anchor, claimed) : anchor;
      const toHole = rules.penWiresFreeHolesOnly
        ? freeHoleFor(project, pin, at, claimed) : at;
      if (!fromHole || !toHole) {
        refusals.push({
          net: net.name, rule: 'penWiresFreeHolesOnly', from: anchorPin, to: pin,
          reason: `there is no free hole on the strip of ${!fromHole ? anchorPin : pin}, `
            + 'and a pen wire goes hole to hole',
        });
        continue;
      }
      // CLAIMED, so the next wire in this same plan does not pick the hole this
      // one just took. Nothing is applied while planning, so the board cannot
      // tell us a hole is spoken for — the plan has to remember for itself.
      claimed.add(`${fromHole.col},${fromHole.row}`);
      claimed.add(`${toHole.col},${toHole.row}`);
      ops.push({
        op: 'addWire', net: net.name, from: fromHole, to: toHole,
        why: `${net.name} is a signal, so ${anchorPin} to ${pin} is point to point, `
          + 'landing on free holes on their strips',
      });
    }
  }

  if (report.shorts.length) {
    notes.push(`${report.shorts.length} short${report.shorts.length === 1 ? '' : 's'} `
      + 'must be cut before any of this is worth applying: '
      + report.shorts.map((s) => s.nets.join('/')).join(', '));
  }

  return { ops, refusals, notes, report };
}

// A free hole on the pin's own strip — the endpoint a pen wire should have.
// Nearest first, because a short wire is a better wire, and skipping anything an
// earlier op in this same plan already took.
function freeHoleFor(project, token, at, claimed) {
  const split = splitPin(token);
  if (!split) return null;
  const free = freeHolesOn(project, split.ref, split.pin)
    .filter((h) => !claimed.has(`${h.col},${h.row}`));
  if (!free.length) return null;
  const dist = (h) => Math.abs(h.col - at.col) + Math.abs(h.row - at.row);
  return [...free].sort((a, b) => dist(a) - dist(b))[0];
}
