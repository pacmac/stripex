// A board is never discarded. It is repaired, and the repair is reported.
// Governed by docs/specs/never-lose-a-board.md

import { suite, eq, ok, softImport } from '../run.mjs';
import { readFileSync } from 'node:fs';

const here = import.meta.url;
const Rep = await softImport('../../src/model/repair.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('repair');

// PETER'S ACTUAL BOARD, as recovered from his browser on 2026-08-30. It is here
// verbatim because the failure this file exists to prevent happened to it: five
// point-to-point placements the editor let him create, and a validation rule
// added an hour later, cost him all thirteen of his real parts.
const PETERS_BOARD = JSON.parse(readFileSync(
  new URL('../../recovered/original-as-saved.json', here), 'utf8',
));

const good = () => {
  const p = boardm.makeProject({ cols: 25, rows: 20 });
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 4, at: { col: 2, row: 2 }, rot: 90 });
  return p;
};

s.check('A GOOD BOARD IS RETURNED UNCHANGED, WITH NOTHING REPAIRED', () => {
  const p = good();
  const { project, repairs } = Rep.loadProject(JSON.stringify(p));
  eq(repairs, [], 'no repairs');
  eq(JSON.stringify(project), JSON.stringify(p), 'byte identical');
});

s.check("PETER'S BOARD LOADS WITH ALL THIRTEEN REAL PARTS", () => {
  // The whole point. Before this, one bad placement blanked the lot.
  const { project, repairs } = Rep.loadProject(JSON.stringify(PETERS_BOARD));
  ok(project, 'a board came back');
  eq(project.placements.length, 13, 'thirteen parts kept');
  eq(project.placements.map((x) => x.ref).sort(),
    ['J1', 'J2', 'J3', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'R1', 'TMC2209'].sort(),
    'and they are the right ones');
  eq(project.breaks.length, 12, 'all twelve cuts kept');
});

s.check('...AND THE FIVE IT COULD NOT KEEP ARE NAMED, NOT VANISHED', () => {
  const { repairs } = Rep.loadProject(JSON.stringify(PETERS_BOARD));
  eq(repairs.length, 5, 'five repairs reported');
  eq(repairs.map((r) => r.ref).sort(), ['A1', 'A2', 'A3', 'A4', 'A5'], 'by ref');
  for (const r of repairs) {
    ok(r.message && r.message.length > 10, `and in words: ${r.message}`);
    ok(r.at && Number.isInteger(r.at.col), `with its position: ${JSON.stringify(r.at)}`);
  }
});

s.check('the repaired board then validates clean', () => {
  const { project } = Rep.loadProject(JSON.stringify(PETERS_BOARD));
  eq(boardm.validateProject(project), [], 'no problems');
});

s.check('AN UNKNOWN PART IS DROPPED, NOT FATAL', () => {
  const p = good();
  p.placements.push({ ref: 'Z1', part: 'flux-capacitor', at: { col: 9, row: 9 }, rot: 0 });
  const { project, repairs } = Rep.loadProject(JSON.stringify(p));
  eq(project.placements.map((x) => x.ref), ['R1'], 'the real part survives');
  eq(repairs.length, 1, 'one repair');
  ok(/flux-capacitor/.test(repairs[0].message), 'naming what it was');
});

s.check('a malformed wire is dropped and reported', () => {
  const p = good();
  p.wires.push({ ref: 'A', from: { col: 1, row: 1 } });   // no `to`
  const { project, repairs } = Rep.loadProject(JSON.stringify(p));
  eq(project.wires, [], 'dropped');
  eq(repairs.length, 1, 'reported');
});

s.check('a break stranded off the board is dropped and reported', () => {
  const p = good();
  p.breaks.push({ row: 99, x: 3, at: 'gap' });
  const { project, repairs } = Rep.loadProject(JSON.stringify(p));
  eq(project.breaks, [], 'dropped');
  eq(repairs.length, 1, 'reported');
});

s.check('UNREADABLE JSON DOES NOT BLANK THE BOARD SILENTLY', () => {
  const { project, repairs } = Rep.loadProject('{not json at all');
  eq(project, null, 'no board came back');
  ok(repairs.length > 0, 'and it says why');
  ok(/read|parse|json/i.test(repairs[0].message), `in words: ${repairs[0].message}`);
});

s.check('nothing stored at all is not an error', () => {
  const { project, repairs } = Rep.loadProject(null);
  eq(project, null, 'nothing to load');
  eq(repairs, [], 'and nothing to report — a first visit is not a fault');
});

s.check('A REPAIR NEVER INVENTS DATA', () => {
  // It may only drop what cannot be kept. Anything it kept must be identical to
  // what was stored.
  const { project } = Rep.loadProject(JSON.stringify(PETERS_BOARD));
  const originals = new Map(PETERS_BOARD.placements.map((x) => [x.ref, JSON.stringify(x)]));
  for (const pl of project.placements) {
    eq(JSON.stringify(pl), originals.get(pl.ref), `${pl.ref} is untouched`);
  }
  eq(JSON.stringify(project.board), JSON.stringify(PETERS_BOARD.board), 'board untouched');
});

s.check('the input string is never mutated into the output object', () => {
  const raw = JSON.stringify(PETERS_BOARD);
  Rep.loadProject(raw);
  eq(JSON.parse(raw).placements.length, 18, 'the stored form still has all eighteen');
});

s.check('repairProject can be called on an object directly', () => {
  const { project, repairs } = Rep.repairProject(structuredClone(PETERS_BOARD));
  eq(project.placements.length, 13, 'same result');
  eq(repairs.length, 5, 'same repairs');
});

process.exit((await s.run()) ? 0 : 1);
