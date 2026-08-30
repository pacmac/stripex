// Checks for the stripboard model and its net derivation.
// Governed by docs/specs/board-model-and-connectivity.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const geom = await softImport('../../src/model/geometry.js', here);
const board = await softImport('../../src/model/board.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const seg = await softImport('../../src/net/segments.js', here);
const der = await softImport('../../src/net/derive.js', here);
const drcm = await softImport('../../src/net/drc.js', here);
const lib = await softImport('../../src/parts/library.js', here);

const s = suite('connectivity');

// ---------------------------------------------------------------- geometry

s.check('pitch is 2.54 mm', () => {
  eq(geom.PITCH_MM, 2.54, 'PITCH_MM');
});

s.check('track width plus gap equals the pitch exactly', () => {
  eq(geom.TRACK_W_MM + geom.TRACK_GAP_MM, geom.PITCH_MM, 'track + gap');
});

s.check('board outside size is cols*pitch by rows*pitch', () => {
  eq(geom.boardSizeMm({ cols: 25, rows: 20 }), { w: 63.5, h: 50.8 }, 'boardSizeMm');
});

s.check('outer hole sits a half pitch from the edge', () => {
  eq(geom.holeToMm(0, 0), { x: 1.27, y: 1.27 }, 'holeToMm(0,0)');
});

// ---------------------------------------------------------------- segments

const B = { cols: 6, rows: 3, pattern: 'strip' };

s.check('an uncut board gives one segment per row spanning its full width', () => {
  const out = seg.segments(B, []);
  eq(out.length, 3, 'segment count');
  eq(out.map((g) => [g.row, g.x0, g.x1]), [[0, 0, 5], [1, 0, 5], [2, 0, 5]], 'segments');
});

s.check('a break splits its row into two segments at the right holes', () => {
  const out = seg.segments(B, [{ row: 1, x: 3 }]).filter((g) => g.row === 1);
  eq(out.map((g) => [g.x0, g.x1]), [[0, 3], [4, 5]], 'row 1 segments');
});

s.check('a break at x=0 leaves a one-hole segment at the left edge', () => {
  const out = seg.segments(B, [{ row: 0, x: 0 }]).filter((g) => g.row === 0);
  eq(out.map((g) => [g.x0, g.x1]), [[0, 0], [1, 5]], 'row 0 segments');
});

s.check('a break at x=cols-2 leaves a one-hole segment at the right edge', () => {
  const out = seg.segments(B, [{ row: 0, x: 4 }]).filter((g) => g.row === 0);
  eq(out.map((g) => [g.x0, g.x1]), [[0, 4], [5, 5]], 'row 0 segments');
});

s.check('the same gap cut twice is still one cut', () => {
  const out = seg.segments(B, [{ row: 2, x: 2 }, { row: 2, x: 2 }]).filter((g) => g.row === 2);
  eq(out.length, 2, 'row 2 segment count');
});

s.check('a break beyond cols-2 is rejected, not silently ignored', () => {
  let threw = false;
  try { seg.segments(B, [{ row: 0, x: 5 }]); } catch { threw = true; }
  ok(threw, 'break at x=cols-1 must throw');
});

s.check('segment ids are unique and stable', () => {
  const out = seg.segments(B, [{ row: 1, x: 3 }]);
  eq(new Set(out.map((g) => g.id)).size, out.length, 'unique ids');
  eq(out.find((g) => g.row === 1 && g.x0 === 4).id, 's:1:1', 'second segment of row 1');
});

// ---------------------------------------------------------------- rotation

s.check('rot 0 is the identity', () => { eq(rot.rotate(1, 0, 0), [1, 0], 'rot 0'); });
s.check('rot 90 takes +x to +y', () => { eq(rot.rotate(1, 0, 90), [0, 1], 'rot 90'); });
s.check('rot 180 takes +x to -x', () => { eq(rot.rotate(1, 0, 180), [-1, 0], 'rot 180'); });
s.check('rot 270 takes +x to -y', () => { eq(rot.rotate(1, 0, 270), [0, -1], 'rot 270'); });

s.check('an unrotated axial part spans its span in x', () => {
  const pins = rot.resolvePins(
    [{ ref: 'R1', part: 'res-axial', span: 4, at: { col: 2, row: 3 }, rot: 0 }],
    lib.getPart,
  );
  eq(pins.map((p) => [p.col, p.row]), [[2, 3], [6, 3]], 'R1 pins');
});

s.check('rotating an axial part 90 makes it span rows instead', () => {
  const pins = rot.resolvePins(
    [{ ref: 'R1', part: 'res-axial', span: 4, at: { col: 2, row: 3 }, rot: 90 }],
    lib.getPart,
  );
  eq(pins.map((p) => [p.col, p.row]), [[2, 3], [2, 7]], 'R1 pins rotated');
});

s.check('a DIP has two rows of pins 0.3 inch apart', () => {
  const pins = rot.resolvePins(
    [{ ref: 'U1', part: 'dip', span: 7, at: { col: 0, row: 0 }, rot: 0 }],
    lib.getPart,
  );
  eq(pins.length, 14, 'DIP-14 pin count');
  eq(pins[0], { ref: 'U1', pin: '1', col: 0, row: 0, electrical: true, kind: 'component' }, 'pin 1');
  // The second row is at -width, so that rotating to straddle the strips puts
  // pin 1 top-LEFT. See docs/specs/footprint-geometry.md.
  eq(pins.find((p) => p.pin === '14').row, -3, 'pin 14 row is 3 holes away');
  eq(Math.abs(pins.find((p) => p.pin === '14').row - pins[0].row), 3, '0.3 inch apart');
});

// -------------------------------------------------------------------- nets

function build(placements, breaks = [], wires = []) {
  const segs = seg.segments(B, breaks);
  const pins = rot.resolvePins(placements, lib.getPart);
  return der.nets(segs, pins, placements, lib.getPart, wires);
}

s.check('a bare board has one net per strip', () => {
  eq(build([]).nets.length, 3, 'net count');
});

s.check('A RESISTOR ACROSS TWO STRIPS DOES NOT MERGE THEM', () => {
  const r = build([{ ref: 'R1', part: 'res-axial', span: 2, at: { col: 2, row: 0 }, rot: 90 }]);
  eq(r.nets.length, 3, 'net count is unchanged by a component');
  ok(r.segmentNet['s:0:0'] !== r.segmentNet['s:2:0'], 'rows 0 and 2 must be different nets');
});

s.check('A WIRE LINK ACROSS TWO STRIPS DOES MERGE THEM', () => {
  const r = build([{ ref: 'W1', part: 'wire-link', span: 2, at: { col: 2, row: 0 }, rot: 90 }]);
  eq(r.nets.length, 2, 'net count drops by one');
  eq(r.segmentNet['s:0:0'], r.segmentNet['s:2:0'], 'rows 0 and 2 must be one net');
});

s.check('a chain of links merges every strip it touches', () => {
  const r = build([
    { ref: 'W1', part: 'wire-link', span: 1, at: { col: 1, row: 0 }, rot: 90 },
    { ref: 'W2', part: 'wire-link', span: 1, at: { col: 4, row: 1 }, rot: 90 },
  ]);
  eq(r.nets.length, 1, 'all three strips are one net');
});

s.check('a break makes one strip into two independent nets', () => {
  const r = build([], [{ row: 1, x: 3 }]);
  eq(r.nets.length, 4, 'net count');
  ok(r.segmentNet['s:1:0'] !== r.segmentNet['s:1:1'], 'the two halves of row 1 differ');
});

s.check('every segment is assigned to exactly one net', () => {
  const r = build([{ ref: 'W1', part: 'wire-link', span: 2, at: { col: 2, row: 0 }, rot: 90 }],
    [{ row: 1, x: 2 }]);
  const segs = seg.segments(B, [{ row: 1, x: 2 }]);
  eq(Object.keys(r.segmentNet).length, segs.length, 'segmentNet covers every segment');
  for (const g of segs) ok(r.segmentNet[g.id], `segment ${g.id} has a net`);
});

s.check('nets are numbered deterministically from the top-left segment down', () => {
  eq(build([]).nets.map((n) => n.id), ['n0', 'n1', 'n2'], 'net ids in row order');
});

s.check('a non-electrical pin occupies its hole but joins no net', () => {
  const r = build([{ ref: 'M1', part: 'mount-hole', at: { col: 0, row: 0 }, rot: 0 }]);
  const n = r.nets.find((x) => x.segments.includes('s:0:0'));
  eq(n.pins.length, 0, 'net has no pins');
});

// ------------------------------------------------------------- pen wires
//
// A wiring pen lays insulated wire point to point between arbitrary holes. It is
// not a part with a span, and it is the way Peter actually builds boards.

s.check('a pen wire runs diagonally between two arbitrary holes and merges them', () => {
  const r = build([], [], [{ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 5, row: 2 } }]);
  eq(r.nets.length, 2, 'rows 0 and 2 became one net');
  eq(r.segmentNet['s:0:0'], r.segmentNet['s:2:0'], 'the two ends share a net');
});

s.check('a pen wire joins segments a link could never reach', () => {
  // Both ends on row 1, but on opposite sides of a break: no straight link along
  // a strip can do this, because the strip itself is what is cut.
  const r = build([], [{ row: 1, x: 2 }],
    [{ ref: 'W1', from: { col: 0, row: 1 }, to: { col: 5, row: 1 } }]);
  eq(r.segmentNet['s:1:0'], r.segmentNet['s:1:1'], 'the cut strip is bridged');
});

s.check('two pen wires chain three strips into one net', () => {
  const r = build([], [], [
    { ref: 'W1', from: { col: 0, row: 0 }, to: { col: 1, row: 1 } },
    { ref: 'W2', from: { col: 3, row: 1 }, to: { col: 4, row: 2 } },
  ]);
  eq(r.nets.length, 1, 'all three strips are one net');
});

s.check('a wire end lands in the net pin list under its own ref', () => {
  const r = build([], [], [{ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 5, row: 2 } }]);
  const n = r.nets.find((x) => x.segments.includes('s:0:0'));
  ok(n.pins.some((p) => p.ref === 'W1'), 'W1 appears on the net it joins');
});

s.check('wire refs are allocated in sequence and skip the ones in use', () => {
  eq(board.nextWireRef({ wires: [], placements: [] }), 'W1', 'first wire');
  eq(board.nextWireRef({ wires: [{ ref: 'W1' }, { ref: 'W3' }], placements: [] }), 'W2',
    'fills the gap');
  eq(board.nextWireRef({ wires: [{ ref: 'W1' }, { ref: 'W2' }], placements: [{ ref: 'W3' }] }),
    'W4', 'a placement using W3 blocks it');
});

// --------------------------------------------------------------------- DRC

const codes = (placements, breaks = [], wires = []) =>
  drcm.drc(B, breaks, placements, lib.getPart, wires).map((d) => d.code);

s.check('a pin off the board is an error', () => {
  ok(codes([{ ref: 'R1', part: 'res-axial', span: 4, at: { col: 4, row: 0 }, rot: 0 }])
    .includes('pin-off-board'), 'pin-off-board fires');
});

s.check('two leads in one hole is an error', () => {
  ok(codes([
    { ref: 'R1', part: 'res-axial', span: 2, at: { col: 0, row: 0 }, rot: 0 },
    { ref: 'R2', part: 'res-axial', span: 2, at: { col: 2, row: 0 }, rot: 0 },
  ]).includes('hole-collision'), 'hole-collision fires');
});

s.check('a component with both legs on one strip is shorted out', () => {
  ok(codes([{ ref: 'R1', part: 'res-axial', span: 3, at: { col: 1, row: 0 }, rot: 0 }])
    .includes('short-across-part'), 'short-across-part fires');
});

s.check('...and a break between its legs clears the short', () => {
  ok(!codes([{ ref: 'R1', part: 'res-axial', span: 3, at: { col: 1, row: 0 }, rot: 0 }],
    [{ row: 0, x: 2 }]).includes('short-across-part'), 'short-across-part is silent');
});

s.check('a wire link on one strip is redundant', () => {
  ok(codes([{ ref: 'W1', part: 'wire-link', span: 2, at: { col: 1, row: 0 }, rot: 0 }])
    .includes('link-redundant'), 'link-redundant fires');
});

s.check('a lone pin on a strip is flagged as floating', () => {
  ok(codes([{ ref: 'W1', part: 'wire-link', span: 2, at: { col: 2, row: 0 }, rot: 90 }])
    .includes('pin-floating'), 'pin-floating fires');
});

s.check('a strip with nothing on it is reported as dead copper', () => {
  ok(codes([]).includes('segment-unused'), 'segment-unused fires');
});

s.check('a wire end off the board is an error', () => {
  ok(codes([], [], [{ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 9, row: 0 } }])
    .includes('wire-off-board'), 'wire-off-board fires');
});

s.check('a wire from a hole to itself is an error', () => {
  ok(codes([], [], [{ ref: 'W1', from: { col: 1, row: 1 }, to: { col: 1, row: 1 } }])
    .includes('wire-degenerate'), 'wire-degenerate fires');
});

s.check('a wire between two holes on one uncut strip is redundant', () => {
  ok(codes([], [], [{ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 5, row: 0 } }])
    .includes('wire-redundant'), 'wire-redundant fires');
});

s.check('...but is not redundant once a break separates its ends', () => {
  ok(!codes([], [{ row: 0, x: 2 }],
    [{ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 5, row: 0 } }])
    .includes('wire-redundant'), 'wire-redundant is silent');
});

s.check('two things sharing a ref is an error', () => {
  ok(codes([{ ref: 'R1', part: 'res-axial', span: 2, at: { col: 0, row: 0 }, rot: 90 }], [],
    [{ ref: 'R1', from: { col: 3, row: 0 }, to: { col: 4, row: 2 } }])
    .includes('duplicate-ref'), 'duplicate-ref fires');
});

s.check('A PEN WIRE SOLDERED TO AN EXISTING COMPONENT JOINT IS NOT A COLLISION', () => {
  // This is how a wiring pen is actually used. Reporting it would flag every
  // correctly built board, so it must stay silent.
  const found = codes(
    [{ ref: 'R1', part: 'res-axial', span: 2, at: { col: 1, row: 0 }, rot: 90 }],
    [],
    [{ ref: 'W1', from: { col: 1, row: 0 }, to: { col: 4, row: 2 } }],
  );
  ok(!found.includes('hole-collision'), 'hole-collision must not fire on a wire end');
});

s.check('a sound layout raises no errors at all', () => {
  const found = drcm.drc(
    B,
    [{ row: 1, x: 2 }],
    [
      { ref: 'R1', part: 'res-axial', span: 2, at: { col: 1, row: 0 }, rot: 90 },
      { ref: 'R2', part: 'res-axial', span: 2, at: { col: 4, row: 0 }, rot: 90 },
    ],
    lib.getPart,
    [{ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 5, row: 2 } }],
  ).filter((d) => d.severity === 'error');
  eq(found, [], 'no errors');
});

// ------------------------------------------------------------- validation

s.check('a project with a break past the last gap fails validation', () => {
  const problems = board.validateProject({
    schema: 'stripex/1',
    board: B,
    breaks: [{ row: 0, x: 5 }],
    placements: [],
    wires: [],
  });
  ok(problems.length > 0, 'validateProject reports the bad break');
});

s.check('a well formed project validates clean', () => {
  eq(board.validateProject({
    schema: 'stripex/1',
    board: B,
    breaks: [{ row: 0, x: 4 }],
    placements: [{ ref: 'R1', part: 'res-axial', span: 2, at: { col: 0, row: 0 }, rot: 0 }],
    wires: [{ ref: 'W1', from: { col: 0, row: 0 }, to: { col: 5, row: 2 } }],
  }), [], 'no problems');
});

s.check('validateProject reports rather than throws on a malformed wire', () => {
  const problems = board.validateProject({
    schema: 'stripex/1',
    board: B,
    breaks: [],
    placements: [],
    wires: [{ ref: 'W1', from: { col: 0, row: 0 } }],
  });
  ok(problems.length > 0, 'the missing end is reported');
});

s.check('an empty project is created valid', () => {
  eq(board.validateProject(board.makeProject({ cols: 10, rows: 8 })), [], 'no problems');
});

process.exit((await s.run()) ? 0 : 1);
