// Components are drawn as silkscreen: outlined, and see-through.
// Governed by docs/specs/silkscreen-components.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('silkscreen');

const bodies = (svg) => [...String(svg).matchAll(
  /<[^>]*data-kind="part-body"[^>]*>/g,
)].map((m) => m[0]);
const attr = (el, name) => {
  const m = el.match(new RegExp(`(?:^|[ ])${name}="([^"]*)"`));
  return m ? m[1] : null;
};

// One of every body shape in the library, so no shape can be missed.
function board() {
  const p = boardm.makeProject({ cols: 40, rows: 24 });
  const put = (ref, part, at, extra = {}) =>
    p.placements.push({ ref, part, at, rot: 90, ...extra });
  put('R1', 'res-axial', { col: 2, row: 1 }, { span: 4 });      // axial
  put('D1', 'diode', { col: 5, row: 1 }, { span: 3 });          // axial, polarised
  put('C1', 'cap-ceramic', { col: 8, row: 1 }, { span: 2 });    // blob
  put('C2', 'cap-electro', { col: 11, row: 1 }, { span: 2 });   // can, polarised
  put('LED1', 'led', { col: 14, row: 1 });                      // can
  put('Q1', 'to92', { col: 17, row: 1 });                       // d-package
  put('Q2', 'to220', { col: 20, row: 1 });                      // tab
  put('U1', 'dip', { col: 26, row: 1 }, { span: 5, width: 3 }); // dip
  put('J1', 'header', { col: 30, row: 1 }, { span: 3 });        // header
  put('L1', 'wire-link', { col: 33, row: 1 }, { span: 2 });     // line
  put('MH1', 'mount-hole', { col: 36, row: 1 });                // hole
  return p;
}

s.check('every part still draws a body', () => {
  const list = bodies(R.renderBoard(board(), {}));
  ok(list.length >= 11, `at least one body per part, got ${list.length}`);
});

s.check('EVERY BODY IS OUTLINED', () => {
  const missing = bodies(R.renderBoard(board(), {}))
    .filter((el) => !attr(el, 'stroke') || attr(el, 'stroke') === 'none');
  eq(missing, [], 'bodies with no stroke');
});

s.check('NO BODY IS PAINTED OPAQUE', () => {
  // Either it has no fill at all, or the fill is washed out enough to see the
  // copper and holes through it.
  const opaque = bodies(R.renderBoard(board(), {})).filter((el) => {
    const fill = attr(el, 'fill');
    if (!fill || fill === 'none') return false;
    const o = attr(el, 'fill-opacity');
    return o === null || Number(o) > 0.3;
  });
  eq(opaque, [], 'bodies you cannot see through');
});

s.check('the wash is present rather than the body being a bare outline', () => {
  // A pure outline makes it hard to tell which holes are UNDER a part, and a
  // hole under a DIP body is one you must not put a wire in.
  const washed = bodies(R.renderBoard(board(), {}))
    .filter((el) => Number(attr(el, 'fill-opacity')) > 0);
  ok(washed.length > 0, 'at least some bodies carry a visible wash');
});

s.check('the outline is thin enough to read as a printed line', () => {
  // Real silkscreen prints at roughly 0.15-0.25 mm. The viewBox is in mm, so a
  // stroke wider than about half a millimetre stops being a line.
  for (const el of bodies(R.renderBoard(board(), {}))) {
    const w = Number(attr(el, 'stroke-width'));
    ok(w > 0.05 && w <= 0.5, `stroke-width ${w} mm`);
  }
});

s.check('the outline colour changes with the theme', () => {
  const strokeOf = (theme) => attr(bodies(R.renderBoard(board(), { theme }))[0], 'stroke');
  ok(strokeOf('light') !== strokeOf('dark'), 'light and dark outlines differ');
});

s.check('a DIP is no longer a solid slab', () => {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.placements.push({ ref: 'U1', part: 'dip', span: 7, width: 3,
    at: { col: 4, row: 2 }, rot: 90 });
  const body = bodies(R.renderBoard(p, {}))[0];
  ok(attr(body, 'stroke'), 'it has an outline');
  ok(Number(attr(body, 'fill-opacity')) <= 0.3, 'and you can see through it');
});

s.check('the copper and holes are still drawn under the parts', () => {
  const svg = R.renderBoard(board(), {});
  const copperAt = svg.indexOf('data-kind="copper"');
  const holeAt = svg.indexOf('data-kind="hole"');
  const bodyAt = svg.indexOf('data-kind="part-body"');
  ok(copperAt >= 0 && holeAt >= 0, 'copper and holes present');
  ok(copperAt < bodyAt && holeAt < bodyAt, 'both painted before the bodies');
});

s.check('leads and pads stay solid — a lead is a wire, not silkscreen', () => {
  const svg = R.renderBoard(board(), {});
  const pads = [...svg.matchAll(/<[^>]*data-kind="pad"[^>]*>/g)].map((m) => m[0]);
  ok(pads.length > 0, 'pads are drawn');
  for (const p of pads) ok(!attr(p, 'fill-opacity'), 'a pad is not washed out');
});

s.check('this is a restyle, not a change of structure', () => {
  const svg = R.renderBoard(board(), {});
  for (const ref of ['R1', 'U1', 'Q2', 'C2']) {
    ok(svg.includes(`data-ref="${ref}"`), `${ref} still drawn`);
  }
  eq([...svg.matchAll(/data-kind="part"/g)].length, 11, 'eleven parts');
});

process.exit((await s.run()) ? 0 : 1);
