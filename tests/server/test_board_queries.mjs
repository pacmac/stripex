// Asking a STORED board what it connects, and what it wastes.
// Governed by docs/specs/board-queries-and-resize.md
//
// /api/check answers all of this and takes a whole project in the body, so a
// caller holding a slug had to GET the board and post it back. The one
// verification step that matters — derive the nets from the copper — had no
// endpoint, and I imported src/model/views.js into node by hand every time.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok, softImport } from '../run.mjs';

process.env.STRIPEX_BOARDS_DIR = mkdtempSync(join(tmpdir(), 'stripex-queries-'));

const s = suite('board-queries');

const mod = await softImport('../../src/server/index.js', import.meta.url);

const server = createServer(mod.app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const api = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* optional */ }
  return { status: res.status, body: json };
};

// A resistor bridging two strips, a pen wire on a pin (against the rules, so a
// RULE finding exists and not only DRC ones), and column 11 deliberately empty.
const PROJECT = {
  schema: 'stripex/1',
  name: 'queries',
  board: { cols: 12, rows: 8, pattern: 'strip' },
  breaks: [],
  wires: [{ ref: 'A', from: { col: 2, row: 2 }, to: { col: 6, row: 5 } }],
  placements: [{ ref: 'R1', part: 'res-axial', at: { col: 2, row: 2 }, rot: 90, span: 2 }],
  netLabels: { '0,0': { name: '0V' } },
};

const made = await api('POST', '/api/boards', { name: 'queries', project: PROJECT });

s.check('the board is there to ask about', () => {
  eq(made.status, 201, `created: ${JSON.stringify(made.body).slice(0, 160)}`);
});

// --------------------------------------------------------------- check

s.check('CHECK ANSWERS FOR A STORED BOARD, BY SLUG', async () => {
  const r = await api('GET', '/api/boards/queries/check');
  eq(r.status, 200, `it answered: ${JSON.stringify(r.body).slice(0, 200)}`);
  ok(Array.isArray(r.body.nets), 'nets');
  ok(Array.isArray(r.body.findings), 'findings');
  ok(Array.isArray(r.body.runList), 'a run list');
  ok(r.body.version, 'and the version, so a caller can act on what it read');
});

s.check('and the nets carry their PINS, so the circuit can be read', async () => {
  // The whole point: without pins a caller still has to load the model to learn
  // which part is on which net.
  const r = await api('GET', '/api/boards/queries/check');
  const withPins = r.body.nets.filter((n) => Array.isArray(n.pins) && n.pins.length);
  ok(withPins.length >= 1, `some net names its pins: ${JSON.stringify(r.body.nets).slice(0, 200)}`);
  const refs = withPins.flatMap((n) => n.pins.map((p) => `${p.ref}.${p.pin}`));
  ok(refs.some((x) => x.startsWith('R1.')), `R1 is on a net: ${refs.join(' ')}`);
});

s.check('and its findings include the RULES, not only the DRC', async () => {
  // The board has a pen wire ending on R1's pin, which is a rule finding. A
  // caller asking "is this board all right" means all of it.
  const r = await api('GET', '/api/boards/queries/check');
  const codes = r.body.findings.map((f) => f.code);
  ok(codes.includes('pen-wire-on-a-pin'), `the rule finding is there: ${[...new Set(codes)].join(' ')}`);
});

s.check('and a board that is not there is a 404', async () => {
  const r = await api('GET', '/api/boards/nope/check');
  eq(r.status, 404, `not found: ${JSON.stringify(r.body)}`);
});

// --------------------------------------------------------------- usage

s.check('USAGE NAMES WHAT OCCUPIES EACH COLUMN AND ROW', async () => {
  const r = await api('GET', '/api/boards/queries/usage');
  eq(r.status, 200, `it answered: ${JSON.stringify(r.body).slice(0, 200)}`);
  const col2 = r.body.columns.find((c) => c.col === 2);
  ok(col2.refs.includes('R1'), `column 2 holds R1: ${JSON.stringify(col2)}`);
  const row2 = r.body.rows.find((x) => x.row === 2);
  ok(row2.refs.includes('R1'), `row 2 holds R1: ${JSON.stringify(row2)}`);
});

s.check('AND LISTS THE EMPTY ONES, WHICH IS THE WHOLE QUESTION', async () => {
  // Column 11 has nothing on it. Finding that by hand is what I did three times
  // in one session, and what Peter spotted twice before I did.
  const r = await api('GET', '/api/boards/queries/usage');
  ok(r.body.emptyColumns.includes(11), `column 11 is empty: ${r.body.emptyColumns.join(' ')}`);
  ok(r.body.emptyRows.includes(7), `row 7 is empty: ${r.body.emptyRows.join(' ')}`);
  ok(!r.body.emptyColumns.includes(2), 'and column 2 is not called empty');
});

s.check('and a strip segment carrying nothing is named with its extent', async () => {
  const r = await api('GET', '/api/boards/queries/usage');
  ok(Array.isArray(r.body.emptySegments), 'there is a list of them');
  ok(r.body.emptySegments.some((x) => x.row === 7),
    `row 7's strip is in it: ${JSON.stringify(r.body.emptySegments).slice(0, 200)}`);
  for (const seg of r.body.emptySegments) {
    ok(Number.isInteger(seg.x0) && Number.isInteger(seg.x1), `${JSON.stringify(seg)} has an extent`);
  }
});

s.check('and every row reports its segments with what is on them', async () => {
  const r = await api('GET', '/api/boards/queries/usage');
  const row2 = r.body.rows.find((x) => x.row === 2);
  ok(Array.isArray(row2.segments) && row2.segments.length >= 1, 'row 2 has segments');
  ok(row2.segments.some((sg) => sg.refs.includes('R1')), `one of them holds R1: ${JSON.stringify(row2.segments)}`);
});

// --------------------------------------------------------------- resize

s.check('RESIZE GOES THROUGH ops, WITH THE SAME VERSION GUARD', async () => {
  const before = await api('GET', '/api/boards/queries');
  const r = await api('POST', '/api/boards/queries/ops', {
    version: before.body.version,
    ops: [{ op: 'setBoardSize', cols: 10, rows: 7 }],
  });
  eq(r.status, 200, `applied: ${JSON.stringify(r.body).slice(0, 200)}`);
  const after = await api('GET', '/api/boards/queries');
  eq(after.body.project.board.cols, 10, 'the board is narrower on disk');
});

s.check('and a resize that would strand something is refused, naming it', async () => {
  const r = await api('POST', '/api/boards/queries/ops', {
    ops: [{ op: 'setBoardSize', cols: 3, rows: 7 }],
  });
  eq(r.status, 400, 'refused');
  ok(/R1|A\b/.test(r.body.error ?? ''), `naming what falls off: ${r.body.error}`);
  const after = await api('GET', '/api/boards/queries');
  eq(after.body.project.board.cols, 10, 'and the board is untouched');
});

const okAll = await s.run();
server.close();
process.exit(okAll ? 0 : 1);
