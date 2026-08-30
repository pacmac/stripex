// Names and colours for nets.
//
// A NET CANNOT OWN ITS NAME, because a net has no stable identity. `n0` means
// "the net containing the top-left-most segment", so adding one wire reshuffles
// the numbering and a name stored against n0 would jump to a different net.
//
// So a name is anchored to a HOLE:
//
//     netLabels = { "4,7": { name: "GND", colour: "#1c1c1c" } }
//
// read as "the net that hole (4,7) is on is called GND". That survives every
// edit which does not destroy the hole — cutting the strip, moving a part,
// adding wires — and when it does break it breaks visibly: the label is simply
// on whatever net that hole now belongs to, which is the truthful answer.
//
// A segment id would not do. `s:3:1` is the second segment of row 3, and cutting
// row 3 further left renumbers it.

import { segments, segmentIndex, holeKey } from '../net/segments.js';
import { effectiveBreaks } from './breaks.js';
import { nets as deriveNets } from '../net/derive.js';
import { resolvePins } from './rotate.js';
import { getPart } from '../parts/library.js';

const parseHole = (key) => {
  const m = /^(-?\d+),(-?\d+)$/.exec(String(key));
  return m ? { col: Number(m[1]), row: Number(m[2]) } : null;
};

// netId -> label, for every labelled net on this board.
export function netLabelsByNet(project, segmentNet) {
  const out = new Map();
  const segs = segments(project.board, effectiveBreaks(project));
  const idx = segmentIndex(segs);
  for (const [key, label] of Object.entries(project.netLabels ?? {})) {
    const hole = parseHole(key);
    if (!hole || !label) continue;
    const segId = idx.get(holeKey(hole.col, hole.row));
    if (!segId) continue;             // off the board, or a spot-faced hole
    const netId = segmentNet[segId];
    if (!netId) continue;
    if (!out.has(netId)) out.set(netId, { ...label, hole });
  }
  return out;
}

// The label on this net, or null.
export function labelFor(project, netId, segmentNet = null) {
  if (!netId) return null;
  const map = netLabelsByNet(project, segmentNet ?? segmentNetOf(project));
  return map.get(netId) ?? null;
}

// The derivation, done here rather than borrowed from the renderer: this is a
// model module and must not import one. No cycle — derive.js, rotate.js and
// breaks.js know nothing about net labels.
function segmentNetOf(project) {
  const segs = segments(project.board, effectiveBreaks(project));
  const pins = resolvePins(project.placements ?? [], getPart);
  return deriveNets(segs, pins, project.placements ?? [], getPart, project.wires ?? [])
    .segmentNet;
}

// Two holes on one net with different names is a mistake worth reporting rather
// than resolving by picking one.
export function netLabelProblems(project, segmentNet = null) {
  const sn = segmentNet ?? segmentNetOf(project);
  const segs = segments(project.board, effectiveBreaks(project));
  const idx = segmentIndex(segs);
  const seen = new Map();
  const problems = [];
  for (const [key, label] of Object.entries(project.netLabels ?? {})) {
    const hole = parseHole(key);
    if (!hole || !label?.name) continue;
    const segId = idx.get(holeKey(hole.col, hole.row));
    if (!segId) continue;
    const netId = sn[segId];
    if (!netId) continue;
    const prev = seen.get(netId);
    if (prev && prev.name !== label.name) {
      problems.push({
        code: 'net-name-conflict',
        message: `one net is called both ${prev.name} and ${label.name}`,
        refs: [prev.name, label.name],
      });
    } else if (!prev) {
      seen.set(netId, label);
    }
  }
  return problems;
}

// Returns a NEW project with the label set, or cleared when `label` is null.
export function setNetLabel(project, hole, label) {
  const next = { ...project, netLabels: { ...(project.netLabels ?? {}) } };
  const key = `${hole.col},${hole.row}`;
  if (!label || (!label.name && !label.colour)) delete next.netLabels[key];
  else next.netLabels[key] = { ...label };
  return next;
}

// Let the renderer supply the derivation without this module importing it.
export function provideSegmentNet(fn) {
  globalThis.__stripexSegmentNet__ = fn;
}
