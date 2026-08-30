// A net you can see, name and colour.
// Governed by docs/specs/net-highlight-and-naming.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const N = await softImport('../../src/model/nets.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('net-labels');

const attr = (el, name) => {
  const m = el.match(new RegExp(`(?:^|[ ])${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const coppers = (svg) => [...String(svg).matchAll(/<rect data-kind="copper"[^>]*>/g)]
  .map((m) => m[0]);
const lit = (svg) => coppers(svg).filter((e) => attr(e, 'data-highlight') === 'true');
const unlit = (svg) => coppers(svg).filter((e) => attr(e, 'data-highlight') !== 'true');
const els = (svg, kind) => [...String(svg).matchAll(
  new RegExp(`<[^>]*data-kind="${kind}"[^>]*>`, 'g'),
)].map((m) => m[0]);

// row0 -A- row2 -B- row4 -C- row6, one net of four strips
function chain() {
  const p = boardm.makeProject({ cols: 12, rows: 8 });
  p.wires.push({ ref: 'A', from: { col: 1, row: 0 }, to: { col: 1, row: 2 } });
  p.wires.push({ ref: 'B', from: { col: 5, row: 2 }, to: { col: 5, row: 4 } });
  p.wires.push({ ref: 'C', from: { col: 9, row: 4 }, to: { col: 9, row: 6 } });
  return p;
}

// -------------------------------------------------------------- the contrast

s.check('A LIT SEGMENT IS NOT WASHED OUT LIKE UNLIT COPPER', () => {
  const p = chain();
  const net = R.netsFor(p).segmentNet['s:0:0'];
  const svg = R.renderBoard(p, { highlightNet: net });
  for (const el of lit(svg)) eq(Number(attr(el, 'opacity')), 1, 'lit is full opacity');
});

s.check('...while unlit copper keeps its wash, because it IS under the board', () => {
  const p = chain();
  const net = R.netsFor(p).segmentNet['s:0:0'];
  const svg = R.renderBoard(p, { highlightNet: net });
  for (const el of unlit(svg)) {
    ok(Number(attr(el, 'opacity')) < 1, 'unlit is washed');
  }
});

s.check('the lit colour is far from the unlit one', () => {
  const p = chain();
  const net = R.netsFor(p).segmentNet['s:0:0'];
  const svg = R.renderBoard(p, { highlightNet: net });
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = rgb(attr(lit(svg)[0], 'fill'));
  const b = rgb(attr(unlit(svg)[0], 'fill'));
  const dist = Math.hypot(...a.map((v, i) => v - b[i]));
  ok(dist > 90, `colour distance ${Math.round(dist)}, want a wide margin`);
});

s.check('A CHAIN OF THREE WIRES LIGHTS ALL FOUR STRIPS', () => {
  // The report was that a highlight "only flows in 1 direction". It does not —
  // this is here so that claim can never become true unnoticed.
  const p = chain();
  const net = R.netsFor(p).segmentNet['s:0:0'];
  const svg = R.renderBoard(p, { highlightNet: net });
  eq(lit(svg).map((e) => attr(e, 'data-seg')).sort(),
    ['s:0:0', 's:2:0', 's:4:0', 's:6:0'], 'all four');
});

// ----------------------------------------------------------------- the label

const named = (over = {}) => {
  const p = chain();
  p.netLabels = { '1,0': { name: 'GND', colour: '#1c1c1c' }, ...over };
  return p;
};

s.check('A LABEL ANCHORED TO A HOLE NAMES THE WHOLE NET', () => {
  const p = named();
  const { segmentNet } = R.netsFor(p);
  for (const seg of ['s:0:0', 's:2:0', 's:4:0', 's:6:0']) {
    eq(N.labelFor(p, segmentNet[seg])?.name, 'GND', `${seg} is on GND`);
  }
  eq(N.labelFor(p, segmentNet['s:1:0']), null, 'an unnamed net has no label');
});

s.check('THE NAME SURVIVES A NET BEING RENUMBERED', () => {
  // Net ids are positional: n0 is the net holding the top-left-most segment, so
  // adding a wire reshuffles them. A name stored against n0 would jump nets.
  const p = named();
  const before = R.netsFor(p).segmentNet['s:0:0'];
  // join two strips ABOVE nothing, forcing the numbering to change
  p.wires.push({ ref: 'D', from: { col: 3, row: 1 }, to: { col: 3, row: 3 } });
  const after = R.netsFor(p).segmentNet['s:0:0'];
  eq(N.labelFor(p, after)?.name, 'GND', 'still GND');
  ok(N.labelFor(p, R.netsFor(p).segmentNet['s:1:0'])?.name !== 'GND',
    'and the new net did not inherit it');
  void before;
});

s.check('a named net draws its name on every one of its segments', () => {
  const svg = R.renderBoard(named(), {});
  const marks = els(svg, 'net-name');
  eq(marks.length, 4, 'one per segment');
  for (const m of marks) eq(attr(m, 'data-name'), 'GND', 'named');
});

s.check('AND TAKES ITS COLOUR, SO GND IS VISIBLE WITHOUT SELECTING ANYTHING', () => {
  const svg = R.renderBoard(named(), {});
  const onNet = coppers(svg).filter((e) => attr(e, 'data-net-name') === 'GND');
  eq(onNet.length, 4, 'four segments carry the name');
  for (const e of onNet) eq(attr(e, 'fill'), '#1c1c1c', 'in the net colour');
});

s.check('A NAME IS READABLE ON THE COLOUR IT SITS ON', () => {
  // Naming a net black made GND dark-on-dark — the one combination that naming
  // a net for legibility must not produce.
  const dark = R.renderBoard(named({ '1,0': { name: 'GND', colour: '#1c1c1c' } }), {});
  const onDark = els(dark, 'net-name')[0];
  eq(attr(onDark, 'fill'), '#f6f6f6', 'light ink on a black net');

  const light = R.renderBoard(named({ '1,0': { name: 'VCC', colour: '#f1f3f5' } }), {});
  eq(attr(els(light, 'net-name')[0], 'fill'), '#141414', 'dark ink on a white net');
});

s.check('the choice uses luminance, not a channel average', () => {
  // A saturated blue is dark to the eye however high its blue channel is.
  eq(R.readableOn('#0000ff', R.THEMES.light), '#f6f6f6', 'blue needs light ink');
  eq(R.readableOn('#e6c02a', R.THEMES.light), '#141414', 'yellow needs dark ink');
});

s.check('a name with no colour keeps the copper colour', () => {
  const p = chain();
  p.netLabels = { '1,0': { name: 'SIG' } };
  const svg = R.renderBoard(p, {});
  const onNet = coppers(svg).filter((e) => attr(e, 'data-net-name') === 'SIG');
  eq(onNet.length, 4, 'still named');
  ok(!onNet.some((e) => attr(e, 'fill') === '#1c1c1c'), 'but not recoloured');
});

s.check('TWO CONFLICTING NAMES ON ONE NET ARE REPORTED', () => {
  const p = named({ '9,6': { name: '+5V' } });   // same net, different name
  const problems = N.netLabelProblems(p);
  ok(problems.length > 0, 'reported');
  ok(/GND|\+5V/.test(problems[0].message), `and named: ${problems[0].message}`);
});

s.check('two names on genuinely different nets are fine', () => {
  const p = named({ '2,1': { name: '+5V' } });   // row 1 is its own net
  eq(N.netLabelProblems(p), [], 'no problem');
});

s.check('a label whose hole is off the board is ignored, not fatal', () => {
  const p = named({ '99,99': { name: 'NOWHERE' } });
  const svg = R.renderBoard(p, {});
  ok(svg.startsWith('<svg'), 'it still renders');
  eq(els(svg, 'net-name').filter((m) => attr(m, 'data-name') === 'NOWHERE').length, 0,
    'and draws nothing for it');
});

s.check('setNetLabel writes and clears without mutating the project', () => {
  const p = chain();
  const withName = N.setNetLabel(p, { col: 1, row: 0 }, { name: 'GND' });
  eq(p.netLabels, undefined, 'the original is untouched');
  eq(withName.netLabels['1,0'].name, 'GND', 'the copy has it');
  const cleared = N.setNetLabel(withName, { col: 1, row: 0 }, null);
  eq(cleared.netLabels['1,0'], undefined, 'and it can be cleared');
});

// ----------------------------------------- every name on a net has a field
// Governed by docs/specs/every-net-name-is-editable.md

const { readFileSync } = await import('node:fs');

// Two names on ONE net: the shape Peter hit. A name is anchored to a HOLE, on
// purpose, so a net may legitimately carry several — and two of them disagreeing
// is a real finding about the board, not something to resolve by dropping one.
function twoNames() {
  const p = chain();
  p.netLabels = { '1,0': { name: '0V' }, '9,6': { name: '3V3' } };
  return p;
}

s.check('A SECOND NAME ON ONE NET IS STILL REACHABLE', () => {
  // netLabelsByNet keeps the first and discards the rest, so the second name had
  // no row, no field, and no way to be renamed or cleared. It was permanent.
  const p = twoNames();
  const { segmentNet } = R.netsFor(p);
  const all = N.netLabelsAllByNet(p, segmentNet);
  const netId = [...all.keys()][0];
  eq(all.size, 1, 'one net');
  eq(all.get(netId).map((l) => l.name), ['0V', '3V3'], 'BOTH names, in stored order');
});

s.check('each one knows the hole it is anchored to', () => {
  // Which is what makes a field able to edit or clear it on its own.
  const p = twoNames();
  const all = N.netLabelsAllByNet(p, R.netsFor(p).segmentNet);
  const holes = [...all.values()][0].map((l) => `${l.hole.col},${l.hole.row}`);
  eq(holes, ['1,0', '9,6'], 'the two holes');
});

s.check('an ordinary net has one, and an unnamed one has none', () => {
  const p = named();
  const all = N.netLabelsAllByNet(p, R.netsFor(p).segmentNet);
  for (const list of all.values()) ok(list.length >= 1, 'no empty lists');
  const plain = boardm.makeProject({ cols: 12, rows: 8 });
  eq(N.netLabelsAllByNet(plain, R.netsFor(plain).segmentNet).size, 0, 'nothing on a bare board');
});

s.check('a label on a killed hole is still dropped', () => {
  // A spot-faced hole belongs to no segment, so it is on no net. That was right
  // before and stays right.
  const p = chain();
  p.breaks = [{ row: 0, x: 3, at: 'hole' }];
  p.netLabels = { '3,0': { name: 'NOWHERE' } };
  const all = N.netLabelsAllByNet(p, R.netsFor(p).segmentNet);
  ok(![...all.values()].flat().some((l) => l.name === 'NOWHERE'), 'not listed');
});

s.check('netLabelsByNet still answers with exactly the first', () => {
  // The board draws one plate per net and the strip takes one colour, so the
  // single-label question still has to have a single answer.
  const p = twoNames();
  const { segmentNet } = R.netsFor(p);
  const one = N.netLabelsByNet(p, segmentNet);
  eq([...one.values()].map((l) => l.name), ['0V'], 'the first');
});

// Every label the Nets tab can put a field on — through whichever map it renders
// from. The fallback is not politeness: it makes the check below MEASURE the
// shortfall rather than merely report a missing function, so the red run says
// "11 of 12" instead of "not a function".
const reachableLabels = (p, sn) => (N.netLabelsAllByNet
  ? [...N.netLabelsAllByNet(p, sn).values()].flat()
  : [...N.netLabelsByNet(p, sn).values()]);

s.check('ON PETER’S BOARD, ALL TWELVE NAMES ARE REACHABLE', () => {
  // The board he pasted on 2026-08-30: 27 nets, 12 stored labels, and 3V3 at
  // hole 6,5 sharing a net with 0V at 0,0 because L4, L5 and L7 join them.
  // Eleven of the twelve had a field and that one did not, so it could not be
  // renamed, cleared, or even located.
  const p = JSON.parse(readFileSync(new URL('../fixtures/two-names-on-one-net.json', import.meta.url)));
  const { segmentNet } = R.netsFor(p);
  const stored = Object.keys(p.netLabels).length;
  const names = reachableLabels(p, segmentNet).map((l) => l.name);
  eq(stored, 12, 'twelve stored');
  ok(names.length === stored, `${names.length} of ${stored} stored names have a field`);
  ok(names.includes('3V3'), `3V3 among them: ${names.join(' ')}`);
});

s.check('validateProject accepts netLabels and rejects a malformed one', () => {
  const p = named();
  eq(boardm.validateProject(p), [], 'a good one is fine');
  const bad = chain();
  bad.netLabels = { 'not-a-hole': { name: 'X' } };
  ok(boardm.validateProject(bad).length > 0, 'a bad key is reported');
});

process.exit((await s.run()) ? 0 : 1);
