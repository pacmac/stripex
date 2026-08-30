// A netlist read, compared and planned against — with no picture in the loop.
// Governed by docs/specs/netlist-to-board.md
//
// Peter: "creating of a new design from a netlist ... would effectively be a
// claude interractive script that will allow you to build a real board."
//
// Nothing in src read one. When v5 sent a netlist I compared it to Peter's board
// BY HAND, three times, in throwaway scripts — which is how nine pen-wire ends
// came to sit on pins, and how I told him 0V and 3V3 were shorted when they were
// not. Every one of those was a comparison a program should have done.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const NL = await softImport('../../src/model/netlist.js', here);
const O = await softImport('../../src/model/ops.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const D = await softImport('../../src/parts/devices.js', here);

const s = suite('netlist');

const TEXT = `
# a driver and its brain
part U1 xiao
part U2 tmc2209

net 0V    U1.GND U2.GND
net STEP  U1.D0  U2.STEP
net DIR   U1.D1  U2.DIR
`;

// ------------------------------------------------------------------ parsing

s.check('A NETLIST IS READ FROM TEXT', () => {
  const nl = NL.parseNetlist(TEXT);
  eq(nl.problems, [], `it parsed cleanly: ${JSON.stringify(nl.problems)}`);
  eq(nl.parts.U1, 'xiao', 'U1 is a XIAO');
  eq(nl.parts.U2, 'tmc2209', 'U2 is a TMC2209');
  eq(Object.keys(nl.nets).sort(), ['0V', 'DIR', 'STEP'], 'three nets');
  eq(nl.nets.STEP, ['U1.D0', 'U2.STEP'], 'with their pins, in order');
});

s.check('and a bad line is reported with its line number, not dropped', () => {
  // Dropping it silently would mean a netlist that says less than its author
  // wrote, and a board that satisfies it while missing a connection.
  const nl = NL.parseNetlist('part U1 xiao\nwibble\nnet A U1.D0\n');
  eq(nl.problems.length, 1, 'one problem');
  eq(nl.problems[0].line, 2, 'naming the line');
  ok(/wibble/.test(nl.problems[0].message), `and quoting it: ${nl.problems[0].message}`);
  eq(nl.nets.A, ['U1.D0'], 'the rest still read');
});

s.check('and JSON is the same netlist already parsed', () => {
  const nl = NL.parseNetlist({ parts: { U1: 'xiao' }, nets: { '0V': ['U1.GND'] } });
  eq(nl.parts.U1, 'xiao', 'parts');
  eq(nl.nets['0V'], ['U1.GND'], 'nets');
});

s.check('A PIN IS NAMED, NEVER NUMBERED', () => {
  // device-aware-api.md's rule: a caller who has to count pins is a caller about
  // to get one wrong. The refusal offers the real names rather than just saying
  // no.
  const nl = NL.parseNetlist('part U1 xiao\nnet A U1.4\n');
  ok(nl.problems.length >= 1, 'it was refused');
  const msg = nl.problems.map((p) => p.message).join(' ');
  ok(/D0|D4/.test(msg), `and the real names are offered: ${msg}`);
});

// ------------------------------------------------------- comparing to a board

// A board with both chips placed and nothing wired between them.
//
// ROTATED 90, which is how a DIL package actually goes on stripboard and how
// Peter placed his: pins down a column put every pin on its OWN strip. At rot 0
// they run along one row, so every pin of the chip is already shorted to every
// other — the first version of this fixture did that, and the planner correctly
// reported the resulting board as one enormous short.
// AND THE STRIPS UNDER EACH CHIP ARE CUT, which is the other half of putting a
// DIL package on stripboard: the two rows of pins sit on the same strips, so
// without a cut between them every pin is shorted to the one opposite. The
// second version of this fixture left them out and the comparison correctly
// reported 0V shorted to DIR — U1.GND and U1.D1 both land on row 3, one on each
// side of the chip.
function placed() {
  const p = boardm.makeProject({ cols: 30, rows: 20 });
  p.placements.push(D.placementFor('xiao', { col: 2, row: 2 }, 90, 'U1'));
  p.placements.push(D.placementFor('tmc2209', { col: 2, row: 11 }, 90, 'U2'));
  for (let row = 2; row <= 8; row += 1) p.breaks.push({ row, x: 5, at: 'gap' });
  for (let row = 11; row <= 18; row += 1) p.breaks.push({ row, x: 4, at: 'gap' });
  return p;
}

s.check('AN UNWIRED CONNECTION IS SPLIT, AND SAYS WHAT IS ON EACH SIDE', () => {
  const report = NL.compareToNetlist(placed(), NL.parseNetlist(TEXT));
  const step = report.nets.find((n) => n.name === 'STEP');
  eq(step.status, 'split', 'STEP is not made yet');
  ok(step.groups.length >= 2, `and the two ends are named: ${JSON.stringify(step.groups)}`);
  ok(JSON.stringify(step.groups).includes('U1.D0'), 'one side is the XIAO pin');
  ok(JSON.stringify(step.groups).includes('U2.STEP'), 'the other is the driver pin');
});

s.check('TWO NETLIST NETS ON ONE BOARD NET IS A SHORT, AND LEADS', () => {
  // The fault that is invisible on a drawing and permanent on copper. A missing
  // connection is work outstanding; a short is damage.
  const p = placed();
  // Join STEP's pin to DIR's pin: one strip now carries two different nets.
  const joined = O.addLink(p, { col: 2, row: 2 }, { col: 2, row: 3 });
  ok(!joined.error, `the link was made: ${joined.error ?? ''}`);

  const report = NL.compareToNetlist(joined.project, NL.parseNetlist(TEXT));
  ok(report.shorts.length >= 1, `a short is reported: ${JSON.stringify(report.shorts)}`);
  const names = report.shorts.flatMap((x) => x.nets).sort();
  ok(names.length >= 2, `naming both nets: ${names.join(', ')}`);
});

s.check('EVERY NET THE PLAN PROPOSED IS MADE, AND THE REST ARE REFUSED OUT LOUD', () => {
  // NOT "every net is satisfied", which is what this check asked for first and
  // was wrong to. On a stripboard two arbitrary pins are usually not in line,
  // and a wire link is straight — so a power net between them cannot be made in
  // one move, and the planner says so instead of proposing a diagonal that
  // applyOps would reject. A plan whose ops get refused on application is worse
  // than no plan, because it looks like progress.
  const p = placed();
  const nl = NL.parseNetlist(TEXT);
  const plan = NL.planFor(p, nl);
  ok(plan.ops.length >= 1, `there is something to do: ${plan.ops.length}`);
  const built = O.applyOps(p, plan.ops);
  ok(!built.error, `the plan applies: ${built.error ?? ''}`);

  const after = NL.compareToNetlist(built.project, nl);
  const planned = new Set(plan.ops.map((o) => o.net));
  const unmade = after.nets
    .filter((n) => planned.has(n.name) && n.status !== 'satisfied').map((n) => n.name);
  eq(unmade, [], `every net the plan acted on is made: ${unmade.join(', ')}`);
  eq(after.shorts, [], 'and nothing was shorted doing it');

  // The ones it did not act on are accounted for, never silently skipped.
  const refused = new Set((plan.refusals ?? []).map((r) => r.net));
  const unexplained = after.nets
    .filter((n) => n.status !== 'satisfied' && !refused.has(n.name)).map((n) => n.name);
  eq(unexplained, [], `nothing was left undone without a reason: ${unexplained.join(', ')}`);
});

s.check('a netlist naming a part the board does not have says so', () => {
  const nl = NL.parseNetlist('part U9 xiao\nnet A U9.D0 U9.D1\n');
  const report = NL.compareToNetlist(placed(), nl);
  ok(report.missing.length >= 1, `the absence is reported: ${JSON.stringify(report.missing)}`);
  ok(/U9/.test(JSON.stringify(report.missing)), 'naming the part');
});

// ------------------------------------------------------------- the planner

s.check('THE PLAN OBEYS THE RULES RATHER THAN RESTATING THEM', () => {
  // Power by wire link, signals point to point — and where it cannot honour a
  // rule it refuses that connection and says which, rather than proposing
  // something applyOps would reject.
  const p = placed();
  const plan = NL.planFor(p, NL.parseNetlist(TEXT));
  const forNet = (name) => plan.ops.filter((o) => o.net === name);

  const power = forNet('0V');
  ok(power.every((o) => o.op === 'addLink'),
    `0V is planned as links: ${power.map((o) => o.op).join(', ')}`);

  for (const op of plan.ops) {
    ok(op.why, `${op.op} says why it is there: ${op.why ?? 'nothing'}`);
  }
  for (const r of plan.refusals ?? []) {
    ok(r.rule || r.reason, `a refusal says which rule: ${JSON.stringify(r)}`);
  }
});

s.check('and a plan is applied all or nothing, like any other batch', () => {
  const p = placed();
  const plan = NL.planFor(p, NL.parseNetlist(TEXT));
  const before = JSON.stringify(p);
  O.applyOps(p, [...plan.ops, { op: 'addLink', from: { col: 0, row: 0 }, to: { col: 5, row: 5 } }]);
  eq(JSON.stringify(p), before, 'the board handed in is untouched by a batch that fails');
});

// ------------------------------------------------- adopting a real footprint

s.check('adoptDevice TURNS A BARE FOOTPRINT INTO THE CHIP IT ALWAYS WAS', () => {
  // Peter's own TMC2209 is part:"dip" with no device and no pin names, drawn
  // before the catalogue existed. Without this, a netlist saying U2.STEP could
  // never address the only real board in the project.
  const p = boardm.makeProject({ cols: 30, rows: 20 });
  p.placements.push({ ref: 'U2', part: 'dip', at: { col: 2, row: 2 }, rot: 0, span: 8, width: 5 });

  const out = O.adoptDevice(p, 'U2', 'tmc2209');
  ok(!out.error, `it applied: ${out.error ?? ''}`);
  const pl = out.project.placements[0];
  eq(pl.device, 'tmc2209', 'it is a TMC2209 now');
  eq(pl.pinNames.length, 16, 'with sixteen names');
  eq(pl.pinNames[1], 'STEP', 'in the catalogue order');
  eq(p.placements[0].pinNames, undefined, 'and the board it was given is untouched');
});

s.check('and is refused on a footprint of the wrong size', () => {
  // An adoption that silently renumbered pins would corrupt a board rather than
  // describe it.
  const p = boardm.makeProject({ cols: 30, rows: 20 });
  p.placements.push({ ref: 'U3', part: 'dip', at: { col: 2, row: 2 }, rot: 0, span: 4, width: 3 });
  const out = O.adoptDevice(p, 'U3', 'tmc2209');
  ok(out.error, 'refused');
  ok(/16|8/.test(out.error), `naming the mismatch: ${out.error}`);
});

process.exit(await s.run() ? 0 : 1);
