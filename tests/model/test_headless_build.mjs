// A board can be built with nothing in the loop but the model.
// Governed by docs/specs/architecture-for-netlist.md
//
// Peter, 2026-08-30: "creating of a new design from a netlist ... would
// effectively be a claude interractive script that will allow you to build a
// real board."
//
// That is impossible while every mutation lives inside a click handler. It was:
// placements.push, wires.push and breaks.push sat in onBoardClick between the
// selection and the status text, so building his rotator wiring meant three
// throwaway scripts, two of which got occupancy wrong and one of which put a
// link's end on the wrong strip.
//
// THIS CHECK HAS TWO HALVES AND NEEDS BOTH. That the operations exist is not the
// property that matters — a second, looser copy of them inside the editor is
// exactly the state that let nine pen wires land on pins. So it also reads
// app.js and insists the editor has no mutation of its own.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const O = await softImport('../../src/model/ops.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const netsMod = await softImport('../../src/net/derive.js', here);

const s = suite('headless-build');

const root = join(dirname(fileURLToPath(here)), '..', '..');
const appSource = () => readFileSync(join(root, 'public', 'app.js'), 'utf8');

// ------------------------------------------------- the operations exist

s.check('EVERY EDIT A BOARD NEEDS IS A FUNCTION', () => {
  // Named one by one rather than counted: a count passes while the one you
  // wanted is the one missing.
  for (const name of ['addPart', 'removePart', 'movePart', 'addWire', 'removeWire',
    'addLink', 'setBreak', 'clearBreak', 'setLabel', 'applyOps', 'freeHolesOn']) {
    eq(typeof O[name], 'function', `ops.${name} is callable`);
  }
});

// ------------------------------------------------- a whole board, no DOM

s.check('A BOARD BUILDS END TO END THROUGH applyOps ALONE', () => {
  // The shape of the thing a netlist builder will do: a device, its cuts, a
  // link for power, a pen wire for a signal, and a name on the net.
  const empty = boardm.makeProject({ cols: 24, rows: 14 });
  const out = O.applyOps(empty, [
    { op: 'addPart', device: 'tmc2209', at: { col: 6, row: 4 }, rot: 0 },
    { op: 'setBreak', row: 9, x: 3, at: 'gap' },
    { op: 'setLabel', hole: { col: 0, row: 4 }, name: '0V' },
    { op: 'addLink', from: { col: 2, row: 4 }, to: { col: 2, row: 7 } },
    { op: 'addWire', from: { col: 20, row: 11 }, to: { col: 20, row: 13 } },
  ]);
  ok(!out.error, `the batch applied: ${out.error ?? ''}`);

  const p = out.project;
  const chip = p.placements.find((x) => x.part === 'dip' || x.device === 'tmc2209');
  ok(chip, `the driver is on the board: ${p.placements.map((x) => x.ref).join(' ')}`);
  eq(chip.span, 8, 'at the real span the catalogue gives it');
  eq(chip.pinNames?.length, 16, 'with its sixteen pin names');
  eq(p.wires.length, 1, 'the signal wire is there');
  ok(p.placements.some((x) => x.part === 'wire-link'), 'and the power link');
  eq(p.netLabels['0,4']?.name, '0V', 'and the net is named');

  // And it is a real board, not just a document: nets derive from it.
  ok(typeof netsMod.nets === 'function', 'nets can be derived from what came out');
});

s.check('and a batch that breaks a rule changes nothing at all', () => {
  // All or nothing. A half-applied netlist is worse than a refused one, because
  // the half that landed looks deliberate.
  const empty = boardm.makeProject({ cols: 16, rows: 10 });
  const out = O.applyOps(empty, [
    { op: 'addPart', part: 'res-axial', at: { col: 2, row: 2 }, rot: 0, span: 4 },
    { op: 'addLink', from: { col: 1, row: 1 }, to: { col: 5, row: 6 } },   // diagonal
  ]);
  ok(out.error, `the diagonal link was refused: ${out.error ?? 'it was not'}`);
  eq(empty.placements.length, 0, 'and the board it was given is untouched');
});

// ------------------------------------------------- the editor has no second copy

s.check('THE EDITOR MUTATES NOTHING ITSELF', () => {
  // The half that actually failed. ops.js existed and the editor went nowhere
  // near it, so there were two sets of rules and a person used the looser one.
  const src = appSource();
  const offenders = [
    [/\bp\.placements\.push\(/, 'p.placements.push'],
    [/\bp\.wires\.push\(/, 'p.wires.push'],
    [/\bp\.breaks\.push\(/, 'p.breaks.push'],
    [/\bp\.placements\s*=\s/, 'assignment to p.placements'],
    [/\bp\.wires\s*=\s/, 'assignment to p.wires'],
    [/\bp\.breaks\s*=\s/, 'assignment to p.breaks'],
    [/\bp\.placements\[[^\]]+\]\s*=\s/, 'assignment into p.placements[]'],
    // HOWEVER IT IS SPELLED. The Focus panel wrote `state.project.breaks =`,
    // which the patterns above could not see — the check was written to catch
    // exactly that edit and missed it on a spelling. And net names written with
    // setNetLabel skip ops.setLabel's rules the same way.
    [/\bstate\.project\.(placements|wires|breaks)\s*=\s/, 'assignment to state.project.<list>'],
    [/\bstate\.project\.(placements|wires|breaks)\[[^\]]+\]\s*=\s/, 'assignment into state.project.<list>[]'],
    [/\bstate\.project\.(placements|wires|breaks)\.(push|splice)\(/, 'push/splice on state.project.<list>'],
    [/\bsetNetLabel\(/, 'setNetLabel called directly'],
  ];
  const found = offenders.filter(([re]) => re.test(src)).map(([, what]) => what);
  eq(found, [], `public/app.js edits the project directly: ${found.join(', ')}`);
});

s.check('and it calls the operations instead', () => {
  const src = appSource();
  ok(/from '\/src\/model\/ops\.js'/.test(src), 'app.js imports ops.js');
  for (const name of ['addPart', 'addWire', 'removePart', 'removeWire',
    'setBreak', 'clearBreak', 'movePart']) {
    ok(new RegExp(`ops\\.${name}\\(`).test(src), `app.js calls ops.${name}`);
  }
});

process.exit(await s.run() ? 0 : 1);
