// Checks for layer visibility and for a selection you can actually see.
// Governed by docs/specs/layers-and-selection.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const V = await softImport('../../src/model/views.js', here);
const board = await softImport('../../src/model/board.js', here);

const s = suite('layers+selection');

const els = (svg, kind) => [...String(svg).matchAll(
  new RegExp(`<[^>]*data-kind="${kind}"[^>]*>`, 'g'),
)].map((m) => m[0]);
const attr = (el, name) => {
  const m = el.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
};

function project() {
  const p = board.makeProject({ cols: 12, rows: 6, name: 'layers' });
  p.breaks.push({ row: 3, x: 5 });
  // a component and a link, so the two can be told apart
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 2, at: { col: 1, row: 0 }, rot: 90 });
  p.placements.push({ ref: 'L1', part: 'wire-link', span: 2, at: { col: 8, row: 0 }, rot: 90 });
  p.wires.push({ ref: 'W1', from: { col: 0, row: 5 }, to: { col: 11, row: 1 } });
  return p;
}

// ------------------------------------------------------------------- layers

s.check('everything is drawn when no layers option is given', () => {
  const svg = R.renderBoard(project(), {});
  // wire-pad rather than wire: a pen wire is two pads and no line, the line
  // appearing only while it is selected.
  for (const kind of ['copper', 'break', 'hole', 'wire-pad', 'part']) {
    ok(els(svg, kind).length > 0, `${kind} is drawn by default`);
  }
});

s.check('an absent layer key still means visible', () => {
  const svg = R.renderBoard(project(), { layers: { copper: false } });
  ok(els(svg, 'hole').length > 0, 'holes survive a partial layers object');
});

for (const [layer, kind] of [
  ['copper', 'copper'], ['breaks', 'break'], ['holes', 'hole'], ['wires', 'wire'],
]) {
  s.check(`hiding the ${layer} layer emits no ${kind} elements`, () => {
    const svg = R.renderBoard(project(), { layers: { [layer]: false } });
    eq(els(svg, kind).length, 0, `${kind} count with ${layer} hidden`);
  });
}

s.check('A HIDDEN LAYER EMITS NOTHING, NOT SOMETHING TRANSPARENT', () => {
  // Invisible-but-present elements still swallow clicks, which defeats the
  // entire point of hiding a layer to reach what is under it.
  const svg = R.renderBoard(project(), { layers: { components: false } });
  ok(!svg.includes('opacity="0"'), 'nothing is hidden by opacity alone');
  ok(!svg.includes('visibility="hidden"'), 'nothing is hidden by visibility');
});

s.check('HIDING COMPONENTS LEAVES LINKS DRAWN', () => {
  const svg = R.renderBoard(project(), { layers: { components: false } });
  const refs = els(svg, 'part').map((e) => attr(e, 'data-ref'));
  eq(refs, ['L1'], 'only the link survives');
});

s.check('HIDING LINKS LEAVES COMPONENTS DRAWN', () => {
  const svg = R.renderBoard(project(), { layers: { links: false } });
  const refs = els(svg, 'part').map((e) => attr(e, 'data-ref'));
  eq(refs, ['R1'], 'only the component survives');
});

s.check('hiding labels keeps the parts but drops their text', () => {
  const svg = R.renderBoard(project(), { layers: { labels: false } });
  ok(els(svg, 'part').length > 0, 'parts still drawn');
  eq(els(svg, 'part-label').length, 0, 'no part labels');
  eq(els(svg, 'wire-label').length, 0, 'no wire labels');
});

s.check('hiding the drc layer drops the markers', () => {
  const p = board.makeProject({ cols: 12, rows: 6 });
  p.placements.push({ ref: 'R1', part: 'res-axial', span: 3, at: { col: 1, row: 0 }, rot: 0 });
  const findings = V.findingsFor(p);
  ok(els(R.renderBoard(p, { findings }), 'drc').length > 0, 'markers drawn by default');
  eq(els(R.renderBoard(p, { findings, layers: { drc: false } }), 'drc').length, 0,
    'markers gone when hidden');
});

s.check('HIDING A LAYER CHANGES NEITHER THE NETS NOR THE CHECKS', () => {
  // Hiding is not deleting. A hidden link still joins its strips.
  const p = project();
  const netsBefore = V.netsFor(p).nets.length;
  const findingsBefore = V.findingsFor(p).length;
  R.renderBoard(p, { layers: { links: false, wires: false, copper: false } });
  eq(V.netsFor(p).nets.length, netsBefore, 'net count unchanged');
  eq(V.findingsFor(p).length, findingsBefore, 'finding count unchanged');
});

// ---------------------------------------------------------------- selection

s.check('nothing is selected by default', () => {
  eq(els(R.renderBoard(project(), {}), 'selection').length, 0, 'no halo');
});

s.check('A SELECTED PART DRAWS A HALO', () => {
  const svg = R.renderBoard(project(), { selection: { kind: 'part', ref: 'R1' } });
  const halo = els(svg, 'selection');
  eq(halo.length, 1, 'one halo');
  eq(attr(halo[0], 'data-ref'), 'R1', 'halo names the part');
});

s.check('A SELECTED WIRE DRAWS A HALO', () => {
  const svg = R.renderBoard(project(), { selection: { kind: 'wire', ref: 'W1' } });
  const halo = els(svg, 'selection');
  eq(halo.length, 1, 'one halo');
  eq(attr(halo[0], 'data-ref'), 'W1', 'halo names the wire');
});

s.check('A SELECTED BREAK DRAWS A HALO', () => {
  const svg = R.renderBoard(project(), { selection: { kind: 'break', ref: '3,5' } });
  const halo = els(svg, 'selection');
  eq(halo.length, 1, 'one halo');
  eq(attr(halo[0], 'data-ref'), '3,5', 'halo names the break');
});

s.check('the selected object is marked on itself as well as haloed', () => {
  const svg = R.renderBoard(project(), { selection: { kind: 'part', ref: 'R1' } });
  const sel = els(svg, 'part').filter((e) => attr(e, 'data-selected') === 'true');
  eq(sel.length, 1, 'exactly one part marked selected');
  eq(attr(sel[0], 'data-ref'), 'R1', 'and it is R1');
});

s.check('the halo is drawn BEHIND its object, not over it', () => {
  // A halo painted on top would hide the very thing it is pointing at.
  const svg = R.renderBoard(project(), { selection: { kind: 'part', ref: 'R1' } });
  const haloAt = svg.indexOf('data-kind="selection"');
  const partAt = svg.indexOf('data-kind="part" data-ref="R1"');
  ok(haloAt >= 0 && partAt >= 0, 'both present');
  ok(haloAt < partAt, 'halo comes first in paint order');
});

s.check('selecting something on a hidden layer draws no halo', () => {
  const svg = R.renderBoard(project(), {
    layers: { components: false },
    selection: { kind: 'part', ref: 'R1' },
  });
  eq(els(svg, 'selection').length, 0, 'no halo for an invisible object');
});

s.check('selecting a ref that does not exist is not an error', () => {
  const svg = R.renderBoard(project(), { selection: { kind: 'part', ref: 'NOPE' } });
  eq(els(svg, 'selection').length, 0, 'no halo, no throw');
});

s.check('the selection survives the underside view', () => {
  const svg = R.renderBoard(project(), {
    view: 'underside', selection: { kind: 'wire', ref: 'W1' },
  });
  eq(els(svg, 'selection').length, 1, 'halo drawn underside too');
});

process.exit((await s.run()) ? 0 : 1);
