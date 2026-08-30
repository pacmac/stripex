// What a net is belongs to the model, not to the picture of it.
// Governed by docs/specs/views-out-of-the-renderer.md
//
// netsFor, findingsFor, runList and cutList were exported from src/render/svg.js,
// whose own first line says "a project in, an SVG string out". The server asked
// the SVG module what the nets were; six model suites loaded the renderer to
// count them. The netlist builder Peter has asked for is a program with no
// picture in it, and every consumer of connectivity forced through svg.js is a
// consumer that cannot run without one.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const V = await softImport('../../src/model/views.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const N = await softImport('../../src/model/nets.js', here);

const s = suite('views');

const root = join(dirname(fileURLToPath(here)), '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const FOUR = ['netsFor', 'findingsFor', 'runList', 'cutList'];

// ------------------------------------------------- they live in the model

s.check('THE FOUR DERIVED VIEWS ARE MODEL FUNCTIONS', () => {
  for (const name of FOUR) eq(typeof V?.[name], 'function', `views.${name} is callable`);
});

s.check('and they answer what they always answered', () => {
  // The behaviour that pins the move: a move that changes an answer is not a
  // move. A resistor bridges two strips and stays two nets, because the strips
  // are not joined by it in the way a link joins them.
  const p = boardm.makeProject({ cols: 12, rows: 6 });
  p.placements.push({ ref: 'R1', part: 'res-axial', at: { col: 2, row: 1 }, rot: 90, span: 2 });
  const two = V.netsFor(p).nets.length;

  const q = boardm.makeProject({ cols: 12, rows: 6 });
  q.placements.push({ ref: 'L1', part: 'wire-link', at: { col: 2, row: 1 }, rot: 90, span: 2 });
  const one = V.netsFor(q).nets.length;

  ok(two > one, `a link joins two strips and a resistor does not: ${two} vs ${one}`);
  ok(Array.isArray(V.findingsFor(p)), 'findingsFor gives a list');
  ok(Array.isArray(V.runList(p)), 'runList gives a list');
  ok(Array.isArray(V.cutList(p)), 'cutList gives a list');
});

s.check('and a cut list carries the cuts a part makes for itself', () => {
  // cutList reads effectiveBreaks, not project.breaks. A caller reading the
  // stored list would build a board missing half its cuts.
  const p = boardm.makeProject({ cols: 16, rows: 8 });
  p.placements.push({ ref: 'U1', part: 'dip', at: { col: 3, row: 2 }, rot: 0, span: 7, width: 3 });
  ok(V.cutList(p).length > (p.breaks ?? []).length,
    `derived cuts are in the list: ${V.cutList(p).length} vs ${(p.breaks ?? []).length} stored`);
});

// ------------------------------------------------- there is no second way

s.check('THE RENDERER EXPORTS NONE OF THEM', () => {
  // Re-exporting would leave the wrong import working, and an available wrong
  // path is the one that gets used. That is the shape that put nine pen wires
  // on pins: ops.js had the rules and the editor had its own way round them.
  const svg = read('src', 'render', 'svg.js');
  const still = FOUR.filter((name) => new RegExp(`export function ${name}\\b`).test(svg));
  eq(still, [], `svg.js still exports connectivity: ${still.join(', ')}`);
});

s.check('and the model never imports the renderer', () => {
  // The property that actually matters. A netlist builder loads the model; if
  // any of it reaches for the renderer, the picture comes with it.
  const offenders = [];
  for (const rel of [['src', 'model', 'views.js'], ['src', 'model', 'nets.js'],
    ['src', 'model', 'ops.js'], ['src', 'model', 'rules.js'], ['src', 'model', 'breaks.js'],
    ['src', 'net', 'derive.js'], ['src', 'net', 'drc.js'], ['src', 'net', 'segments.js']]) {
    if (/from '[^']*render\//.test(read(...rel))) offenders.push(rel.join('/'));
  }
  eq(offenders, [], `these import the renderer: ${offenders.join(', ')}`);
});

s.check('and the server asks the renderer only to draw', () => {
  const src = read('src', 'server', 'index.js');
  const line = /import \{([^}]*)\} from '\.\.\/render\/svg\.js'/.exec(src)?.[1] ?? '';
  const named = line.split(',').map((x) => x.trim()).filter(Boolean);
  const wrong = named.filter((x) => FOUR.includes(x));
  eq(wrong, [], `the server imports connectivity from the renderer: ${wrong.join(', ')}`);
});

// ------------------------------------------------- the dead global is gone

s.check('provideSegmentNet AND ITS GLOBAL ARE GONE', () => {
  // It set globalThis.__stripexSegmentNet__ and nothing anywhere read it — the
  // scar of an earlier attempt at this same separation. A dead workaround for a
  // dependency that should not exist reads as a live mechanism.
  eq(typeof N.provideSegmentNet, 'undefined', 'nets.js no longer exports it');
  const src = read('src', 'model', 'nets.js');
  ok(!/__stripexSegmentNet__/.test(src), 'and the global is not written anywhere');
});

process.exit(await s.run() ? 0 : 1);
