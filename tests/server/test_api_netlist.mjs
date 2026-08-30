// The netlist endpoints: check, and plan.
// Governed by docs/specs/netlist-to-board.md
//
// v5 asked to drive stripex with a netlist rather than prose. These are the two
// calls that makes possible: "does my board do this yet" and "what would you do
// next", with the applying left to /ops so nothing is built by a caller that has
// not looked at the plan.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok, softImport } from '../run.mjs';

process.env.STRIPEX_BOARDS_DIR = mkdtempSync(join(tmpdir(), 'stripex-nlapi-'));

const s = suite('api-netlist');

const mod = await softImport('../../src/server/index.js', import.meta.url);
const D = await softImport('../../src/parts/devices.js', import.meta.url);

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
  try { json = await res.json(); } catch { /* a body is optional */ }
  return { status: res.status, body: json };
};

const NETLIST = `
part U1 xiao
part U2 tmc2209
net 0V   U1.GND U2.GND
net STEP U1.D0  U2.STEP
net DIR  U1.D1  U2.DIR
`;

// A board with both chips, rotated so each pin has its own strip, and the strips
// under each chip cut — which is what putting a DIL package on stripboard means.
const project = () => {
  const p = {
    schema: 'stripex/1',
    name: 'API Netlist',
    board: { cols: 30, rows: 20, pattern: 'strip' },
    breaks: [],
    wires: [],
    placements: [
      D.placementFor('xiao', { col: 2, row: 2 }, 90, 'U1'),
      D.placementFor('tmc2209', { col: 2, row: 11 }, 90, 'U2'),
    ],
    netLabels: {},
  };
  for (let row = 2; row <= 8; row += 1) p.breaks.push({ row, x: 5, at: 'gap' });
  for (let row = 11; row <= 18; row += 1) p.breaks.push({ row, x: 4, at: 'gap' });
  return p;
};

// The slug is DERIVED from the name — boards are addressed by what they are
// called, not by an id the caller invents.
const made = await api('POST', '/api/boards', { name: 'nl', project: project() });

s.check('the board is there to compare against', () => {
  eq(made.status, 201, `created: ${JSON.stringify(made.body).slice(0, 160)}`);
});

s.check('CHECK SAYS WHAT IS NOT MADE YET', async () => {
  const r = await api('POST', '/api/boards/nl/netlist/check', { netlist: NETLIST });
  eq(r.status, 200, 'it answered');
  eq(r.body.total, 3, 'three nets in the netlist');
  eq(r.body.satisfied, 0, 'none of them made yet');
  const step = r.body.nets.find((n) => n.name === 'STEP');
  eq(step.status, 'split', 'STEP is split');
  ok(JSON.stringify(step.groups).includes('U2.STEP'), 'naming the pins on each side');
});

s.check('and it does not write anything', async () => {
  const before = await api('GET', '/api/boards/nl');
  await api('POST', '/api/boards/nl/netlist/check', { netlist: NETLIST });
  const after = await api('GET', '/api/boards/nl');
  eq(after.body.version, before.body.version, 'the board is untouched by a check');
});

s.check('PLAN PROPOSES OPS AND REFUSES WITH THE RULE', async () => {
  const r = await api('POST', '/api/boards/nl/netlist/plan', { netlist: NETLIST });
  eq(r.status, 200, 'it answered');
  ok(r.body.ops.length >= 1, `there are ops: ${r.body.ops.length}`);
  for (const op of r.body.ops) ok(op.why, `${op.op} says why: ${op.why ?? 'nothing'}`);
  // 0V's two grounds are not in line and a link is straight, so it is refused
  // rather than proposed as a diagonal the ops endpoint would reject.
  const zero = (r.body.refusals ?? []).find((x) => x.net === '0V');
  ok(zero, `0V is refused: ${JSON.stringify(r.body.refusals)}`);
  ok(zero.rule || zero.reason, 'naming the rule or the reason');
});

s.check('and a plan applied through /ops satisfies what it planned', async () => {
  // The loop closing: plan, apply, check. All three over HTTP, which is what v5
  // would actually do.
  const plan = await api('POST', '/api/boards/nl/netlist/plan', { netlist: NETLIST });
  const applied = await api('POST', '/api/boards/nl/ops', { ops: plan.body.ops });
  eq(applied.status, 200, `applied: ${JSON.stringify(applied.body).slice(0, 200)}`);

  const after = await api('POST', '/api/boards/nl/netlist/check', { netlist: NETLIST });
  const planned = new Set(plan.body.ops.map((o) => o.net));
  const unmade = after.body.nets
    .filter((n) => planned.has(n.name) && n.status !== 'satisfied').map((n) => n.name);
  eq(unmade, [], `every planned net is made: ${unmade.join(', ')}`);
  eq(after.body.shorts, [], 'and nothing was shorted');
});

s.check('a netlist that is not sent is refused, not guessed at', async () => {
  const r = await api('POST', '/api/boards/nl/netlist/check', {});
  eq(r.status, 400, 'refused');
  ok(/netlist/i.test(r.body.error), `saying what is missing: ${r.body.error}`);
});

s.check('and a board that does not exist is a 404', async () => {
  const r = await api('POST', '/api/boards/nope/netlist/check', { netlist: NETLIST });
  eq(r.status, 404, `not found: ${JSON.stringify(r.body)}`);
});

s.check('A PIN THAT DOES NOT EXIST IS REPORTED WITH THE REAL NAMES', async () => {
  const r = await api('POST', '/api/boards/nl/netlist/check', {
    netlist: 'part U1 xiao\nnet A U1.4 U1.D0\n',
  });
  eq(r.status, 200, 'it answered');
  ok(r.body.problems.length >= 1, 'the bad pin is a problem');
  ok(/D0/.test(JSON.stringify(r.body.problems)), 'and the real names are offered');
});

const okAll = await s.run();
server.close();
process.exit(okAll ? 0 : 1);
