// Every edit leaves a snapshot, so there is always something to go back to.
// Governed by docs/specs/never-lose-a-board.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const H = await softImport('../../src/model/history.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('history');

// A localStorage stand-in, so this runs in node. `cap` makes it refuse writes
// past a size, the way a real quota does.
function fakeStore(cap = Infinity) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      const total = [...map.entries()]
        .filter(([kk]) => kk !== k).reduce((n, [, vv]) => n + vv.length, 0) + v.length;
      if (total > cap) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      map.set(k, v);
    },
    removeItem: (k) => map.delete(k),
  };
}

const boardWith = (n) => {
  const p = boardm.makeProject({ cols: 25, rows: 20 });
  for (let i = 0; i < n; i += 1) {
    p.placements.push({ ref: `R${i + 1}`, part: 'res-axial', span: 2,
      at: { col: i % 20, row: Math.floor(i / 20) }, rot: 90 });
  }
  return p;
};

s.check('a snapshot goes in and comes back out', () => {
  const store = fakeStore();
  H.pushSnapshot(store, boardWith(3));
  const hist = H.readHistory(store);
  eq(hist.length, 1, 'one entry');
  eq(hist[0].project.placements.length, 3, 'with the board in it');
  ok(hist[0].at, 'and when it was taken');
});

s.check('NEWEST FIRST, so "the one before it went wrong" is at the top', () => {
  const store = fakeStore();
  for (let i = 1; i <= 4; i += 1) H.pushSnapshot(store, boardWith(i));
  const hist = H.readHistory(store);
  eq(hist.map((h) => h.project.placements.length), [4, 3, 2, 1], 'newest first');
});

s.check('THE CAP IS THIRTY, AND THE OLDEST GO', () => {
  const store = fakeStore();
  for (let i = 1; i <= 40; i += 1) H.pushSnapshot(store, boardWith(i));
  const hist = H.readHistory(store);
  eq(hist.length, H.MAX_SNAPSHOTS, `capped at ${H.MAX_SNAPSHOTS}`);
  eq(H.MAX_SNAPSHOTS, 30, 'which is thirty');
  eq(hist[0].project.placements.length, 40, 'the newest is kept');
  eq(hist[hist.length - 1].project.placements.length, 11, 'and the oldest ten are gone');
});

s.check('an identical board is not snapshotted twice', () => {
  // Otherwise thirty slots fill with the same picture and the history is useless.
  const store = fakeStore();
  const p = boardWith(3);
  H.pushSnapshot(store, p);
  H.pushSnapshot(store, p);
  H.pushSnapshot(store, p);
  eq(H.readHistory(store).length, 1, 'one entry');
});

s.check('A FULL DISK DROPS HISTORY, NEVER THE CURRENT BOARD', () => {
  // The rule that matters: if something has to give, it is never the board the
  // user is looking at.
  const store = fakeStore(4000);
  let wrote = true;
  for (let i = 1; i <= 30; i += 1) wrote = H.pushSnapshot(store, boardWith(i)) && wrote;
  const hist = H.readHistory(store);
  ok(hist.length > 0, `some history survived (${hist.length})`);
  ok(hist.length < 30, 'but not all of it, because the cap was reached');
  eq(hist[0].project.placements.length, 30, 'and the newest is the one kept');
});

s.check('a snapshot survives a round trip exactly', () => {
  const store = fakeStore();
  const p = boardWith(5);
  p.netLabels = { '3,3': { name: 'GND' } };
  H.pushSnapshot(store, p);
  eq(JSON.stringify(H.readHistory(store)[0].project), JSON.stringify(p), 'identical');
});

s.check('unreadable history is treated as no history, not as a crash', () => {
  const store = fakeStore();
  store.setItem(H.HISTORY_KEY, 'not json');
  eq(H.readHistory(store), [], 'empty');
  ok(H.pushSnapshot(store, boardWith(1)), 'and it recovers on the next write');
  eq(H.readHistory(store).length, 1, 'with one entry');
});

s.check('history is a separate key from the board', () => {
  // Or a corrupt history would take the board with it.
  ok(H.HISTORY_KEY !== 'stripex.project', 'different key');
  const store = fakeStore();
  store.setItem('stripex.project', JSON.stringify(boardWith(2)));
  H.pushSnapshot(store, boardWith(3));
  ok(store.getItem('stripex.project'), 'the board is still there');
});

s.check('a snapshot carries enough to choose between them by eye', () => {
  const store = fakeStore();
  H.pushSnapshot(store, boardWith(7));
  const [h] = H.readHistory(store);
  eq(H.describe(h).parts, 7, 'how many parts');
  ok(H.describe(h).when, 'and when');
});

process.exit((await s.run()) ? 0 : 1);
