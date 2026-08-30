// Loading a board without ever throwing one away.
//
// WHAT THIS EXISTS TO PREVENT, in one paragraph, because it actually happened:
//
// Peter drew a board with thirteen parts and twelve cuts. It also held five
// placements of a wire-only part — which the editor itself had let him create.
// An hour later a validation rule was added that makes those illegal. The next
// time he opened the editor, load() ran validateProject, saw five problems, and
// returned null. He got an empty 25x20 board and a console warning he never
// saw. Thirteen parts and an afternoon, gone, because of five marks the tool
// had allowed.
//
// THE RULE: a board is never discarded. It is repaired, and the repair is
// reported. What cannot be kept is named — its ref and its position — so it can
// be shown on screen rather than vanishing.
//
// A repair may only DROP. It never invents, corrects or moves anything: every
// item that survives is byte-identical to what was stored. Guessing at a fix is
// how you lose the difference between "your board, minus one part" and "a board
// I made up".

import { validateProject, SCHEMA } from './board.js';
import { hasPart, getPart, isWireOnly } from '../parts/library.js';

const isHole = (h) => h && Number.isInteger(h.col) && Number.isInteger(h.row);

// { project, repairs }. `project` is null only when there is nothing to load or
// nothing readable; `repairs` always says why.
export function loadProject(raw) {
  if (raw == null || raw === '') return { project: null, repairs: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      project: null,
      repairs: [{
        code: 'unreadable',
        message: `the stored board could not be read as JSON: ${e.message}`,
      }],
    };
  }
  return repairProject(parsed);
}

export function repairProject(input) {
  const repairs = [];
  if (!input || typeof input !== 'object' || !input.board) {
    return {
      project: null,
      repairs: [{ code: 'unreadable', message: 'the stored board has no board in it' }],
    };
  }

  const board = input.board;
  const project = {
    ...input,
    schema: input.schema ?? SCHEMA,
    board,
    breaks: [],
    placements: [],
    wires: [],
  };

  const onBoard = (h) => h.col >= 0 && h.row >= 0
    && h.col < board.cols && h.row < board.rows;

  for (const [i, pl] of (input.placements ?? []).entries()) {
    const drop = (code, message) => repairs.push({
      code, message, ref: pl?.ref ?? `placements[${i}]`, at: pl?.at,
    });
    if (!pl || !pl.ref) { drop('no-ref', `a placement with no reference was removed`); continue; }
    if (!hasPart(pl.part)) {
      drop('unknown-part',
        `${pl.ref} used the part "${pl.part}", which this version does not have, so it `
        + 'was removed');
      continue;
    }
    if (isWireOnly(getPart(pl.part))) {
      // The exact case that cost Peter his board.
      drop('wire-as-placement',
        `${pl.ref} was a ${getPart(pl.part).name} placed as a component, which it cannot `
        + `be. It was at hole ${pl.at?.col},${pl.at?.row} — draw it with the wire tool`);
      continue;
    }
    if (!isHole(pl.at)) { drop('bad-position', `${pl.ref} had no position and was removed`); continue; }
    project.placements.push(pl);
  }

  for (const [i, w] of (input.wires ?? []).entries()) {
    const drop = (message) => repairs.push({
      code: 'bad-wire', message, ref: w?.ref ?? `wires[${i}]`, at: w?.from,
    });
    if (!w || !w.ref) { drop('a wire with no reference was removed'); continue; }
    if (!isHole(w.from) || !isHole(w.to)) {
      drop(`${w.ref} was missing an end and was removed`);
      continue;
    }
    if (!onBoard(w.from) || !onBoard(w.to)) {
      drop(`${w.ref} ran off the board and was removed`);
      continue;
    }
    project.wires.push(w);
  }

  for (const [i, b] of (input.breaks ?? []).entries()) {
    const at = b?.at ?? 'gap';
    const last = at === 'hole' ? board.cols - 1 : board.cols - 2;
    if (!Number.isInteger(b?.row) || !Number.isInteger(b?.x)
        || b.row < 0 || b.row >= board.rows || b.x < 0 || b.x > last
        || (at !== 'gap' && at !== 'hole')) {
      repairs.push({
        code: 'bad-cut',
        message: `a cut at row ${b?.row}, hole ${b?.x} is not on this board and was removed`,
        ref: `breaks[${i}]`,
        at: Number.isInteger(b?.x) && Number.isInteger(b?.row) ? { col: b.x, row: b.row } : undefined,
      });
      continue;
    }
    project.breaks.push(b);
  }

  // Anything validateProject still dislikes is reported rather than acted on:
  // dropping more on a rule this function does not understand would be exactly
  // the all-or-nothing behaviour it exists to replace.
  for (const p of validateProject(project)) {
    repairs.push({ code: p.code, message: p.message });
  }

  return { project, repairs };
}
