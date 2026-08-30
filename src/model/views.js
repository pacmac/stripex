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
