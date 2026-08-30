// Net derivation.
//
// THE RULE THIS FILE EXISTS FOR:
//
//     Segments are NOT nets. Segments are the VERTICES of a graph whose EDGES
//     are zero-ohm connections. Nets are its connected components.
//
// A resistor bridging two strips does not merge them — it is a component with
// impedance sitting BETWEEN two nets. Treating every part as a connection is the
// obvious shortcut and it produces a tool that reports a short on every working
// circuit. Only two things are zero-ohm:
//
//   - a placement of a part with kind "link"  (a bare wire link, bent to a span)
//   - a wire                                   (a pen wire, point to point)

import { segmentIndex, holeKey } from './segments.js';
import { compareLabels } from '../model/labels.js';

function makeUnionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (a) => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(a) !== r) { const nx = parent.get(a); parent.set(a, r); a = nx; }
    return r;
  };
  return {
    find,
    union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    },
  };
}

export function nets(segs, pins, placements = [], getPart = null, wires = []) {
  const idx = segmentIndex(segs);
  const uf = makeUnionFind(segs.map((g) => g.id));

  // --- edges from zero-ohm placements ------------------------------------
  if (getPart) {
    const byRef = new Map();
    for (const p of pins) {
      if (!p.electrical) continue;
      if (!byRef.has(p.ref)) byRef.set(p.ref, []);
      byRef.get(p.ref).push(p);
    }
    for (const pl of placements) {
      let part;
      try { part = getPart(pl.part); } catch { continue; }
      if (part.kind !== 'link') continue;
      const own = byRef.get(pl.ref) ?? [];
      const segIds = own.map((p) => idx.get(holeKey(p.col, p.row))).filter(Boolean);
      for (let i = 1; i < segIds.length; i += 1) uf.union(segIds[0], segIds[i]);
    }
  }

  // --- edges from pen wires ----------------------------------------------
  for (const w of wires) {
    if (!w || !w.from || !w.to) continue;
    const a = idx.get(holeKey(w.from.col, w.from.row));
    const b = idx.get(holeKey(w.to.col, w.to.row));
    if (a && b) uf.union(a, b);
  }

  // --- collect connected components --------------------------------------
  const groups = new Map();
  for (const g of segs) {
    const root = uf.find(g.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(g);
  }

  // Deterministic numbering: a net is named for its top-left-most segment, so
  // two saves of the same layout diff to nothing.
  const ordered = [...groups.values()].map((members) => {
    members.sort((a, b) => (a.row - b.row) || (a.x0 - b.x0));
    return members;
  });
  ordered.sort((a, b) => (a[0].row - b[0].row) || (a[0].x0 - b[0].x0));

  const segmentNet = {};
  const outNets = ordered.map((members, i) => {
    const id = `n${i}`;
    for (const g of members) segmentNet[g.id] = id;
    return { id, name: null, segments: members.map((g) => g.id), pins: [] };
  });

  const byId = new Map(outNets.map((n) => [n.id, n]));

  for (const p of pins) {
    if (!p.electrical) continue;
    const segId = idx.get(holeKey(p.col, p.row));
    if (!segId) continue;                       // off board: DRC's problem, not ours
    byId.get(segmentNet[segId]).pins.push(p);
  }

  // A wire end is a connection on its net and belongs in the net's list, so that
  // "what is on this net" answers with the wires too and the run list can be
  // built per net.
  for (const w of wires) {
    if (!w || !w.from || !w.to) continue;
    for (const [end, hole] of [['from', w.from], ['to', w.to]]) {
      const segId = idx.get(holeKey(hole.col, hole.row));
      if (!segId) continue;
      byId.get(segmentNet[segId]).pins.push({
        ref: w.ref,
        pin: end,
        col: hole.col,
        row: hole.row,
        electrical: true,
        kind: 'wire',
      });
    }
  }

  return { nets: outNets, segmentNet };
}

// Every wire on the board as a build list, in ref order: what a wiring pen is
// actually driven from. The exporter renders this; it is derived here so the
// editor and the exporter cannot disagree about it.
export function wireRunList(wires, segmentNet = null, segs = null) {
  const idx = segs ? segmentIndex(segs) : null;
  // compareLabels, not a string compare: A, AA, AB, B is what plain lexical
  // ordering gives, and this is a build document you work down.
  return [...wires]
    .sort((a, b) => compareLabels(a.ref, b.ref))
    .map((w) => ({
      ref: w.ref,
      from: w.from,
      to: w.to,
      net: idx && segmentNet
        ? (segmentNet[idx.get(holeKey(w.from.col, w.from.row))] ?? null)
        : null,
    }));
}
