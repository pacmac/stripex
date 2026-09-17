// Row letters and column numbers at the board's edges, as a layer.
// Governed by docs/specs/edge-labels-layer.md
//
// Peter, 2026-09-17: "another layer is needed at the outer edges of the board
// showing the rows (A-Z, AA...etc) and columns 1,2,34,.... etc. must be a
// layer."

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('edge-labels');

const labels = (svg) => [...String(svg).matchAll(/<text[^>]*data-kind="edge-label"[^>]*>([^<]*)<\/text>/g)]
  .map((m) => ({
    axis: m[0].match(/data-axis="([^"]*)"/)?.[1],
    x: Number(m[0].match(/ x="([^"]*)"/)?.[1]),
    y: Number(m[0].match(/ y="([^"]*)"/)?.[1]),
    text: m[1],
  }));
const viewBox = (svg) => String(svg).match(/viewBox="([^"]*)"/)?.[1];

s.check('THE LAYER EXISTS, ON BY DEFAULT', () => {
  eq(R.DEFAULT_LAYERS.edgeLabels, true, 'edgeLabels defaults on');
});

s.check('ROWS ARE LETTERED ON BOTH SIDES, COLUMNS NUMBERED TOP AND BOTTOM', () => {
  const svg = R.renderBoard(boardm.makeProject({ cols: 30, rows: 12 }));
  const got = labels(svg);
  const rows = got.filter((l) => l.axis === 'row').map((l) => l.text);
  const cols = got.filter((l) => l.axis === 'col').map((l) => l.text);
  eq(rows.length, 24, 'twelve rows, each lettered twice');
  eq([...new Set(rows)], ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'], 'A to L');
  eq(cols.length, 60, 'thirty columns, each numbered twice');
  eq([...new Set(cols)], Array.from({ length: 30 }, (_, i) => String(i + 1)), '1 to 30');
  const tall = labels(R.renderBoard(boardm.makeProject({ cols: 4, rows: 28 })))
    .filter((l) => l.axis === 'row').map((l) => l.text);
  eq(tall.at(-1), 'AB', 'the 28th row is AB — Z is followed by AA');
});

s.check('SWITCHED OFF, NONE ARE DRAWN AND THE WINDOW DOES NOT MOVE', () => {
  const p = boardm.makeProject({ cols: 20, rows: 10 });
  const on = R.renderBoard(p);
  const off = R.renderBoard(p, { layers: { ...R.DEFAULT_LAYERS, edgeLabels: false } });
  eq(labels(off).length, 0, 'no labels');
  eq(viewBox(off), viewBox(on), 'the same window either way, so nothing jumps');
});

s.check('THE UNDERSIDE VIEW MIRRORS THE COLUMNS', () => {
  const p = boardm.makeProject({ cols: 10, rows: 6 });
  const col = (svg, t) => labels(svg).find((l) => l.axis === 'col' && l.text === t)?.x;
  const top = R.renderBoard(p, { view: 'top' });
  const under = R.renderBoard(p, { view: 'underside' });
  ok(col(top, '1') !== undefined && col(under, '1') !== undefined,
    'column 1 is labelled in both views');
  if (col(top, '1') === undefined || col(under, '1') === undefined) return;
  ok(col(top, '1') < col(top, '2'), 'from the top, column 1 is left of column 2');
  ok(col(under, '1') > col(under, '2'), 'from the underside, it is right of it');
});

s.check('EVERY LABEL IS OUTSIDE THE BOARD, AND CLEAR OF A NET NAME PUSHED OFF AN EDGE', () => {
  const p = boardm.makeProject({ cols: 16, rows: 8 });
  // A full-width rail with a name — the case that is drawn off the right edge —
  // and a strip cut short so its name goes off the left.
  p.placements = [
    { ref: 'R1', part: 'res-axial', span: 4, at: { col: 5, row: 2 }, rot: 90 },
    { ref: 'R2', part: 'res-axial', span: 4, at: { col: 9, row: 2 }, rot: 90 },
  ];
  p.breaks = [{ row: 2, x: 7, at: 'gap' }];
  p.netLabels = { '5,6': { name: 'VCC' }, '5,2': { name: 'SIGNAL' } };
  const svg = R.renderBoard(p);
  const { w, h } = { w: 16 * 2.54, h: 8 * 2.54 };
  const got = labels(svg);
  const inside = got.filter((l) => l.x > 0 && l.x < w && l.y > 0 && l.y < h);
  eq(inside.length, 0, `no label inside the board: ${inside.map((l) => l.text)}`);

  const plates = [...svg.matchAll(/<rect data-kind="net-name-plate"[^>]*>/g)].map((m) => ({
    x: Number(m[0].match(/ x="([^"]*)"/)[1]), y: Number(m[0].match(/ y="([^"]*)"/)[1]),
    w: Number(m[0].match(/ width="([^"]*)"/)[1]), h: Number(m[0].match(/ height="([^"]*)"/)[1]),
  }));
  ok(plates.some((q) => q.x < 0 || q.x + q.w > w), 'a net name is drawn off an edge');
  // A label is text centred on (x, y); treat it as a 1.2 mm box.
  const hits = got.filter((l) => plates.some((q) => l.x + 0.6 > q.x && l.x - 0.6 < q.x + q.w
    && l.y + 0.6 > q.y && l.y - 0.6 < q.y + q.h));
  eq(hits.map((l) => l.text), [], 'no label overlaps a net-name plate');
});

process.exit((await s.run()) ? 0 : 1);
