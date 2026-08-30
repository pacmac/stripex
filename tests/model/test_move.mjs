// Moving a device point to point, by one of its pins.
// Governed by docs/specs/move-by-pin.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const M = await softImport('../../src/model/move.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const lib = await softImport('../../src/parts/library.js', here);
const cur = await softImport('../../src/render/cursors.js', here);

const s = suite('move');

const U1 = () => ({ ref: 'U1', part: 'dip', span: 7, width: 3,
  at: { col: 10, row: 4 }, rot: 90 });
const R1 = () => ({ ref: 'R1', part: 'res-axial', span: 4,
  at: { col: 3, row: 3 }, rot: 0, value: '10k' });

const pinAt = (pl, name) => {
  const p = rot.resolvePins([pl], lib.getPart).find((x) => x.pin === name);
  return p ? { col: p.col, row: p.row } : null;
};
const move = (pl, pin, target) => M.movePlacementByPin(pl, lib.getPart, pin, target);

s.check('THE NAMED PIN LANDS EXACTLY ON THE TARGET HOLE', () => {
  const target = { col: 18, row: 12 };
  eq(pinAt(move(U1(), '1', target), '1'), target, 'pin 1');
});

s.check('it works for any pin, not just the first', () => {
  const target = { col: 2, row: 15 };
  eq(pinAt(move(U1(), '8', target), '8'), target, 'pin 8');
  eq(pinAt(move(U1(), '14', target), '14'), target, 'pin 14');
});

s.check('EVERY OTHER PIN KEEPS ITS OFFSET — THE PART COMES WITH IT', () => {
  const start = U1();
  const moved = move(start, '1', { col: 18, row: 12 });
  const before = rot.resolvePins([start], lib.getPart);
  const after = rot.resolvePins([moved], lib.getPart);
  const p1b = before.find((p) => p.pin === '1');
  const p1a = after.find((p) => p.pin === '1');
  const dc = p1a.col - p1b.col;
  const dr = p1a.row - p1b.row;
  for (const b of before) {
    const a = after.find((x) => x.pin === b.pin);
    eq([a.col - b.col, a.row - b.row], [dc, dr], `pin ${b.pin} moved by the same amount`);
  }
});

s.check('MOVING BY A DIFFERENT PIN PUTS THE PART SOMEWHERE ELSE', () => {
  // The whole point of picking the pin: you place the pin that matters.
  const target = { col: 15, row: 10 };
  const byOne = move(U1(), '1', target);
  const byEight = move(U1(), '8', target);
  ok(JSON.stringify(byOne.at) !== JSON.stringify(byEight.at), 'different anchors');
  eq(pinAt(byOne, '1'), target, 'pin 1 on target');
  eq(pinAt(byEight, '8'), target, 'pin 8 on target');
});

s.check('rotation, span and width are untouched — a move is not a transform', () => {
  const moved = move(U1(), '1', { col: 1, row: 1 });
  eq([moved.rot, moved.span, moved.width], [90, 7, 3], 'unchanged');
});

s.check('the ref and value survive the move', () => {
  const moved = move(R1(), '2', { col: 12, row: 9 });
  eq([moved.ref, moved.value], ['R1', '10k'], 'unchanged');
});

s.check('moving a pin to the hole it is already in changes nothing', () => {
  const start = R1();
  const where = pinAt(start, '1');
  eq(move(start, '1', where).at, start.at, 'no-op');
});

s.check('a rotated part moves as a rigid body', () => {
  for (const r of [0, 90, 180, 270]) {
    const start = { ...U1(), rot: r };
    const target = { col: 14, row: 14 };
    const moved = move(start, '1', target);
    eq(pinAt(moved, '1'), target, `rot ${r}: pin 1 on target`);
    eq(moved.rot, r, `rot ${r}: unchanged`);
  }
});

s.check('AN UNKNOWN PIN RETURNS THE PLACEMENT UNCHANGED RATHER THAN THROWING', () => {
  // A stale handle — the part edited between the two clicks — must not take the
  // editor down.
  const start = U1();
  const out = move(start, '99', { col: 1, row: 1 });
  eq(JSON.stringify(out), JSON.stringify(start), 'unchanged');
});

s.check('an unknown part is survivable too', () => {
  const odd = { ref: 'X1', part: 'no-such-part', at: { col: 1, row: 1 }, rot: 0 };
  const out = M.movePlacementByPin(odd, lib.getPart, '1', { col: 5, row: 5 });
  eq(JSON.stringify(out), JSON.stringify(odd), 'unchanged');
});

s.check('the input is never mutated', () => {
  const start = U1();
  const snapshot = JSON.stringify(start);
  move(start, '1', { col: 20, row: 18 });
  eq(JSON.stringify(start), snapshot, 'untouched');
});

s.check('a move that puts pins off the board is allowed, not refused', () => {
  // The DRC reports pin-off-board; refusing would make it impossible to shuffle
  // a part across a crowded board in two steps.
  const moved = move(U1(), '1', { col: -3, row: -3 });
  eq(pinAt(moved, '1'), { col: -3, row: -3 }, 'it went where it was told');
});

s.check('the move tool gets a crosshair', () => {
  eq(cur.cursorFor('move'), 'crosshair', 'move cursor');
  ok(Object.keys(cur.CURSORS).includes('move'), 'move is a known tool');
});

process.exit((await s.run()) ? 0 : 1);
