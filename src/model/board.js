// Project construction and validation.
//
// validateProject REPORTS and never throws. It is called on every load, on every
// save and on anything arriving over HTTP, and a validator that throws turns a
// recoverable "this file is wrong here" into a dead editor.

import { hasPart, getPart, pinsOf } from '../parts/library.js';
import { isRotation } from './rotate.js';

export const SCHEMA = 'stripex/1';

export function makeProject({ cols = 25, rows = 20, name = 'untitled' } = {}) {
  return {
    schema: SCHEMA,
    name,
    board: { cols, rows, pattern: 'strip' },
    breaks: [],
    placements: [],
    wires: [],
  };
}

const isHole = (h) => h && Number.isInteger(h.col) && Number.isInteger(h.row);

export function validateProject(project) {
  const p = [];
  const bad = (code, message) => p.push({ code, message });

  if (!project || typeof project !== 'object') {
    return [{ code: 'not-an-object', message: 'project is not an object' }];
  }
  if (project.schema !== SCHEMA) {
    bad('bad-schema', `schema is ${JSON.stringify(project.schema)}, want ${SCHEMA}`);
  }

  const b = project.board;
  if (!b || typeof b !== 'object') {
    bad('no-board', 'project.board is missing');
    return p;
  }
  if (!Number.isInteger(b.cols) || b.cols < 2) bad('bad-cols', `cols is ${b.cols}, want >= 2`);
  if (!Number.isInteger(b.rows) || b.rows < 1) bad('bad-rows', `rows is ${b.rows}, want >= 1`);
  if (b.pattern !== 'strip') {
    // The field exists so a later pattern engine needs no schema change. It is
    // validated strictly so the code never pretends to handle a board it cannot.
    bad('bad-pattern', `pattern is ${JSON.stringify(b.pattern)}; only "strip" is supported`);
  }
  if (p.length) return p;

  const onBoard = (h) => h.col >= 0 && h.row >= 0 && h.col < b.cols && h.row < b.rows;

  for (const [i, br] of (project.breaks ?? []).entries()) {
    const at = br?.at ?? 'gap';
    if (at !== 'gap' && at !== 'hole') {
      bad('bad-break-type',
        `breaks[${i}].at is ${JSON.stringify(br?.at)}, want "gap" (knife between two `
        + 'holes) or "hole" (spot-face cutter at one)');
      continue;
    }
    if (!Number.isInteger(br?.row) || br.row < 0 || br.row > b.rows - 1) {
      bad('bad-break-row', `breaks[${i}].row is ${br?.row}, want 0..${b.rows - 1}`);
    }
    // A knife cut lives in a gap, of which there are cols-1; a spot-face lives
    // at a hole, of which there are cols. The last valid x differs by one.
    const last = at === 'gap' ? b.cols - 2 : b.cols - 1;
    if (!Number.isInteger(br?.x) || br.x < 0 || br.x > last) {
      bad('bad-break-x',
        `breaks[${i}].x is ${br?.x}, want 0..${last} — ${at === 'gap'
          ? 'a knife cut sits between hole x and x+1, so the last valid gap is cols-2'
          : 'a spot-face sits at hole x, so the last valid hole is cols-1'}`);
    }
  }

  const refs = new Map();
  const claim = (ref, where) => {
    if (ref == null || ref === '') { bad('missing-ref', `${where} has no ref`); return; }
    if (refs.has(ref)) bad('duplicate-ref', `ref ${ref} is used by ${refs.get(ref)} and ${where}`);
    else refs.set(ref, where);
  };

  for (const [i, pl] of (project.placements ?? []).entries()) {
    const where = `placements[${i}]`;
    claim(pl?.ref, where);
    if (!hasPart(pl?.part)) { bad('unknown-part', `${where} uses unknown part ${pl?.part}`); continue; }
    if (!isHole(pl.at)) { bad('bad-anchor', `${where}.at is not a hole`); continue; }
    if (!isRotation(pl.rot ?? 0)) bad('bad-rotation', `${where}.rot is ${pl.rot}, want 0/90/180/270`);
    const part = getPart(pl.part);
    if (part.parametric) {
      const span = pl.span ?? part.defaultSpan;
      if (!Number.isInteger(span) || span < (part.minSpan ?? 1)) {
        bad('bad-span', `${where}.span is ${pl.span}, want an integer >= ${part.minSpan ?? 1}`);
      }
    }
    // Pin geometry is checked here only for resolvability; whether the pins land
    // on the board is a DRC finding, not a schema error — a half-placed part
    // must still be loadable so the user can drag it back on.
    try { pinsOf(part, pl.span); } catch (e) { bad('bad-part-geometry', `${where}: ${e.message}`); }
  }

  for (const [i, w] of (project.wires ?? []).entries()) {
    const where = `wires[${i}]`;
    claim(w?.ref, where);
    if (!isHole(w?.from)) { bad('bad-wire-end', `${where}.from is not a hole`); continue; }
    if (!isHole(w?.to)) { bad('bad-wire-end', `${where}.to is not a hole`); continue; }
    if (!onBoard(w.from) || !onBoard(w.to)) {
      bad('wire-off-board', `${where} runs outside the ${b.cols}x${b.rows} board`);
    }
  }

  return p;
}

// Next free wire ref. Wires and placements share one ref namespace, so a
// placement called W3 blocks W3 for wires — the run list a wiring pen is driven
// from must have exactly one W3 in it.
export function nextWireRef(project) {
  const taken = new Set([
    ...(project.wires ?? []).map((w) => w.ref),
    ...(project.placements ?? []).map((pl) => pl.ref),
  ]);
  for (let i = 1; ; i += 1) {
    const ref = `W${i}`;
    if (!taken.has(ref)) return ref;
  }
}

// Next free ref for a part, using the conventional letter for its kind.
//
// The prefix comes from the part definition. It used to live in a table here,
// which is a second list of every part that has to be kept in step with the
// library — and was not: the 0603 was added to the library and came out as "X1".
export function nextPartRef(project, partId) {
  const prefix = (hasPart(partId) ? getPart(partId).refPrefix : null) ?? 'X';
  const taken = new Set([
    ...(project.placements ?? []).map((pl) => pl.ref),
    ...(project.wires ?? []).map((w) => w.ref),
  ]);
  for (let i = 1; ; i += 1) {
    const ref = `${prefix}${i}`;
    if (!taken.has(ref)) return ref;
  }
}
