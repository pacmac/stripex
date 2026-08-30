// Derived views of a project: what is connected, what is wrong with it, what to
// solder and what to cut.
//
// These four used to be exported from src/render/svg.js, whose own first line
// says "a project in, an SVG string out". They answer connectivity questions and
// have nothing to do with drawing, so the server asked the SVG module what the
// nets were and six model suites loaded the renderer to count them.
//
// It matters because the netlist builder is a program with no picture in it.
// Anything forced to import the renderer to learn what is connected to what is
// something that cannot run without one.
//
// EVERYTHING HERE READS effectiveBreaks, NEVER project.breaks. The cuts a part
// requires are derived from the placements rather than stored, so a caller that
// read the stored list would see a board missing half its cuts — and would build
// one.

import { segments } from '../net/segments.js';
import { resolvePins } from './rotate.js';
import { nets as deriveNets, wireRunList } from '../net/derive.js';
import { drc } from '../net/drc.js';
import { effectiveBreaks } from './breaks.js';
import { getPart } from '../parts/library.js';
import { holeKey, segmentIndex } from '../net/segments.js';

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

// WHAT OCCUPIES EACH COLUMN, EACH ROW, AND EACH STRIP SEGMENT.
//
// This is the whole of the tightening pass — the question "which column is
// holding one part, and which strip carries nothing at all" — and before this it
// was written by hand in node three times in a single session. That is the same
// shape as freeHolesOn, whose own comment records it as "written three times in
// three scratch scripts and wrong twice", and it is the reason Peter twice
// spotted waste before I did: the answer was not anywhere he or I could see it.
//
// Pen wire ENDS count as occupancy alongside pins, because a hole with a wire
// soldered into it is as spoken for as one with a lead in it. A copper-side pad
// does not enter the hole, but it is still something the column is carrying, so
// it appears in `refs` while leaving the hole free — the two questions are
// different and only occupancy-for-a-wire needs the stricter one.
export function usageOf(project) {
  const cols = project?.board?.cols ?? 0;
  const rows = project?.board?.rows ?? 0;

  const byCol = new Map();
  const byRow = new Map();
  const byHole = new Map();
  const note = (col, row, ref) => {
    if (!byCol.has(col)) byCol.set(col, new Set());
    if (!byRow.has(row)) byRow.set(row, new Set());
    byCol.get(col).add(ref);
    byRow.get(row).add(ref);
    if (!byHole.has(holeKey(col, row))) byHole.set(holeKey(col, row), new Set());
    byHole.get(holeKey(col, row)).add(ref);
  };

  let pins = [];
  try { pins = resolvePins(project.placements ?? [], getPart); } catch { /* the DRC reports it */ }
  for (const p of pins) note(p.col, p.row, p.ref);
  for (const w of project.wires ?? []) {
    for (const h of [w.from, w.to]) if (h) note(h.col, h.row, w.ref);
  }

  const segs = segments(project.board, effectiveBreaks(project));
  const refsIn = (seg) => {
    const out = new Set();
    for (let c = seg.x0; c <= seg.x1; c += 1) {
      for (const ref of byHole.get(holeKey(c, seg.row)) ?? []) out.add(ref);
    }
    return [...out].sort();
  };

  const { segmentNet } = netsFor(project);
  const rowsOut = [];
  const emptySegments = [];
  for (let row = 0; row < rows; row += 1) {
    const mine = segs.filter((g) => g.row === row).sort((a, b) => a.x0 - b.x0);
    const segsOut = mine.map((g) => {
      const refs = refsIn(g);
      if (!refs.length) emptySegments.push({ row, x0: g.x0, x1: g.x1 });
      return { x0: g.x0, x1: g.x1, net: segmentNet[g.id] ?? null, refs };
    });
    rowsOut.push({ row, refs: [...(byRow.get(row) ?? [])].sort(), segments: segsOut });
  }

  const columns = [];
  for (let col = 0; col < cols; col += 1) {
    columns.push({ col, refs: [...(byCol.get(col) ?? [])].sort() });
  }

  return {
    columns,
    rows: rowsOut,
    emptyColumns: columns.filter((c) => !c.refs.length).map((c) => c.col),
    emptyRows: rowsOut.filter((r) => !r.refs.length).map((r) => r.row),
    emptySegments,
  };
}
