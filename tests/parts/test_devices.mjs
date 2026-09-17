// Devices are presets over generic footprints, and a placed one owes the
// catalogue nothing.
// Governed by docs/specs/left-panel-cards.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const D = await softImport('../../src/parts/devices.js', here);
const lib = await softImport('../../src/parts/library.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const drcm = await softImport('../../src/net/drc.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const R = await softImport('../../src/render/svg.js', here);
const geom = await softImport('../../src/model/geometry.js', here);

const s = suite('devices');

// ------------------------------------------------------------- categories

s.check('EVERY PART DECLARES A CATEGORY', () => {
  // Present from the start while there are fourteen, because retrofitting a
  // taxonomy at sixty means touching every entry and every caller.
  const missing = Object.values(lib.PARTS).filter((p) => !p.category).map((p) => p.id);
  eq(missing, [], 'parts with no category');
});

s.check('the categories are a closed set, in a declared order', () => {
  ok(Array.isArray(lib.CATEGORIES), 'CATEGORIES is a list');
  const known = new Set(lib.CATEGORIES.map((c) => c.id));
  for (const p of Object.values(lib.PARTS)) {
    ok(known.has(p.category), `${p.id} is in category ${p.category}`);
  }
  for (const c of lib.CATEGORIES) ok(c.name, `${c.id} has a display name`);
});

s.check('partList carries the category through', () => {
  for (const p of lib.partList()) ok(p.category, `${p.id}`);
});

// ------------------------------------------------------------- pin names

s.check('a generic part names its pins as it always did', () => {
  eq(lib.pinLabel(lib.getPart('dip'), 0), '1', 'first pin of a DIP');
  eq(lib.pinLabel(lib.getPart('led'), 0), 'A', 'an LED anode keeps its own name');
});

s.check('A DEVICE NAMES ITS PINS', () => {
  const dev = D.getDevice('tmc2209');
  ok(dev, 'the worked example exists');
  ok(Array.isArray(dev.pins) && dev.pins.length > 0, 'it has pin names');
  eq(dev.pins.length, dev.span * 2, 'one per pin');
});

// -------------------------------------------------------- placing a device

s.check('A DEVICE RESOLVES TO A PLACEMENT OF ITS BASE PART', () => {
  const pl = D.placementFor('tmc2209', { col: 4, row: 11 }, 90, 'U1');
  const dev = D.getDevice('tmc2209');
  eq(pl.part, dev.base, 'it is a dip');
  eq(pl.span, dev.span, 'carrying the span');
  eq(pl.width, dev.width, 'and the width');
  eq(pl.silk, dev.silk, 'and the silk colour');
  eq(pl.autoBreak, dev.autoBreak, 'and the cut setting');
  eq(pl.at, { col: 4, row: 11 }, 'at the hole given');
  eq(pl.rot, 90, 'at the rotation given');
});

s.check('THE PLACEMENT OWES THE CATALOGUE NOTHING', () => {
  // If a placement merely referenced a device id, editing or deleting a
  // catalogue entry would silently change or break every board using it. A board
  // was already lost this session to that shape of coupling.
  const pl = D.placementFor('tmc2209', { col: 4, row: 11 }, 90, 'U1');
  const before = rot.resolvePins([pl], lib.getPart);

  const saved = D.DEVICES.tmc2209;
  delete D.DEVICES.tmc2209;                 // the catalogue changes under it
  try {
    const after = rot.resolvePins([pl], lib.getPart);
    eq(JSON.stringify(after), JSON.stringify(before), 'the board is unchanged');
    ok(after.length > 0, 'and still resolves');
  } finally {
    D.DEVICES.tmc2209 = saved;
  }
});

s.check('the placement keeps a device tag, for display only', () => {
  const pl = D.placementFor('tmc2209', { col: 1, row: 1 }, 0, 'U1');
  eq(pl.device, 'tmc2209', 'tagged');
});

s.check('IT CARRIES ITS OWN PIN NAMES, NOT A LOOKUP', () => {
  const pl = D.placementFor('tmc2209', { col: 1, row: 1 }, 0, 'U1');
  const dev = D.getDevice('tmc2209');
  eq(pl.pinNames, dev.pins, 'names copied onto the placement');
});

s.check('AND THOSE NAMES REACH THE RESOLVED PINS', () => {
  const pl = D.placementFor('tmc2209', { col: 2, row: 2 }, 0, 'U1');
  const pins = rot.resolvePins([pl], lib.getPart);
  eq(pins.map((p) => p.pin), D.getDevice('tmc2209').pins, 'named, not numbered');
});

s.check('a generic placement is unaffected and still numbered', () => {
  const pins = rot.resolvePins(
    [{ ref: 'U9', part: 'dip', span: 7, width: 3, at: { col: 2, row: 2 }, rot: 0 }],
    lib.getPart,
  );
  eq(pins[0].pin, '1', 'first pin is 1');
});

s.check('A DRC MESSAGE ON A DEVICE USES ITS PIN NAMES', () => {
  // Not through missing-required-break, which names the HOLES to cut rather
  // than pins — that was my wrong assumption first time round. pin-off-board
  // names the pin, so hang the device over the edge.
  const B = { cols: 25, rows: 20, pattern: 'strip' };
  const pl = D.placementFor('tmc2209', { col: 1, row: 1 }, 0, 'U1');
  const found = drcm.drc(B, [], [pl], lib.getPart, [])
    .filter((f) => f.code === 'pin-off-board');
  ok(found.length > 0, `some pins hang off the board (${found.length})`);
  const names = new Set(D.getDevice('tmc2209').pins);
  ok(found.every((f) => [...names].some((nm) => f.message.includes(`pin ${nm}`))),
    `every message names a real pin: ${found[0].message}`);
  ok(!/pin \d+ /.test(found[0].message), 'and none of them says a bare number');
});

s.check('a project holding a device placement validates', () => {
  const p = boardm.makeProject({ cols: 25, rows: 20 });
  p.placements.push(D.placementFor('tmc2209', { col: 4, row: 6 }, 90, 'U1'));
  eq(boardm.validateProject(p), [], 'no problems');
});

s.check('deviceList is what a palette would show', () => {
  const list = D.deviceList();
  ok(list.length >= 1, 'at least the worked example');
  for (const d of list) {
    ok(d.id && d.name && d.category, `${d.id} is listable`);
    ok(lib.hasPart(d.base), `${d.id} is built on a real part: ${d.base}`);
  }
});

// ------------------------------------------- real components, with real names
// Governed by docs/specs/named-components.md

// Every pin name a device declares, checked against the geometry its footprint
// actually resolves to. This is the check that catches a name list drifting from
// the part it names — the failure that makes a pinout worse than no pinout,
// because it still reads as fact.
const resolvedPinCount = (id) => rot.resolvePins(
  [D.placementFor(id, { col: 2, row: 2 }, 0, 'X1')], lib.getPart,
).length;

s.check('EVERY DEVICE NAMES EXACTLY THE PINS IT HAS', () => {
  for (const d of Object.values(D.DEVICES)) {
    eq(d.pins.length, resolvedPinCount(d.id), `${d.id}: names vs resolved pins`);
  }
});

s.check('and no device names a pin twice', () => {
  // Two pins with one name cannot be told apart by a netlist.
  for (const d of Object.values(D.DEVICES)) {
    eq(d.pins.length, new Set(d.pins).size, `${d.id} has distinct names`);
  }
});

s.check('THE XIAO IS 14 PINS, 7 A SIDE, 6 HOLES ACROSS', () => {
  // 2.54 mm pitch and 15.24 mm between the rows, which is 6 holes. Same
  // footprint across the whole XIAO family — that is the point of it.
  const d = D.getDevice('xiao');
  ok(d, 'the XIAO exists');
  eq(d.span, 7, 'seven a side');
  eq(d.width, 6, 'rows 6 holes apart = 15.24 mm');
  eq(d.pins.length, 14, 'fourteen pins');
});

s.check('AND ITS NAMES ARE THE SILKSCREEN ONES, IN ORDER', () => {
  // Down one side and back up the other, which is how this project numbers a
  // DIL and how the XIAO numbers itself. No alternate functions: a pin has one
  // name, and SDA belongs to the net, not to D4.
  eq(D.getDevice('xiao').pins, [
    'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6',
    'D7', 'D8', 'D9', 'D10', '3V3', 'GND', '5V',
  ], 'the fourteen');
});

s.check('THE TMC2209 IS 16 PINS AND 5 HOLES ACROSS', () => {
  // From a board file for the SilentStepStick v2.0: headers at x=142.1511 and
  // x=154.8511, which is 12.7 mm apart — 5 holes, not the 6 a guess would give.
  const d = D.getDevice('tmc2209');
  eq(d.span, 8, 'eight a side');
  eq(d.width, 5, 'rows 12.7 mm apart');
  eq(d.pins.length, 16, 'sixteen pins');
});

s.check('with the motor outputs in the naming Peter uses', () => {
  // His own net labels are M1A M1B M2A M2B, mapped through the A4988-compatible
  // positions those pads occupy: OA2->M2B, OA1->M2A, OB1->M1A, OB2->M1B.
  const pins = D.getDevice('tmc2209').pins;
  for (const nm of ['M1A', 'M1B', 'M2A', 'M2B', 'EN', 'STEP', 'DIR', 'VM', 'VIO']) {
    ok(pins.includes(nm), `${nm} is a pin`);
  }
});

s.check('UNVERIFIED PINS ARE NAMED, NOT A FLAG ON THE WHOLE DEVICE', () => {
  // 14 of the TMC2209's 16 names are traceable to a source and it would be a
  // lie to mark them otherwise. Two pads are unrouted in that source.
  const d = D.getDevice('tmc2209');
  ok(Array.isArray(d.unverifiedPins), 'a list, not a boolean');
  eq(d.unverifiedPins, ['NC3', 'NC4'], 'exactly the two unrouted pads');
});

s.check('every unverified name is a real pin of its device', () => {
  for (const d of Object.values(D.DEVICES)) {
    for (const nm of d.unverifiedPins ?? []) {
      ok(d.pins.includes(nm), `${d.id}: ${nm} is one of its pins`);
    }
  }
});

s.check('deviceList carries the unverified pins through', () => {
  // A flag in a source comment is not a warning: nobody reads the file while
  // looking at a screen.
  const row = D.deviceList().find((d) => d.id === 'tmc2209');
  eq(row.unverifiedPins, ['NC3', 'NC4'], 'the palette can say which');
});

s.check('JST XH COMES STRAIGHT AND RIGHT ANGLE, 2 TO 8 WAY', () => {
  const jst = Object.values(D.DEVICES).filter((d) => d.id.startsWith('jst-xh'));
  ok(jst.length > 0, 'JST devices exist');
  const ways = new Set(jst.map((d) => d.ways));
  for (const n of [2, 3, 4, 5, 6, 7, 8]) ok(ways.has(n), `${n} way`);
  const angles = new Set(jst.map((d) => d.angle));
  eq([...angles].sort(), ['right', 'straight'], 'both bodies');
});

s.check('a JST names one pin per way', () => {
  const jst = Object.values(D.DEVICES).filter((d) => d.id.startsWith('jst-xh'));
  ok(jst.length >= 14, `2..8 ways in two bodies is 14 entries: got ${jst.length}`);
  for (const d of jst) eq(d.pins.length, d.ways, `${d.id}: ${d.ways} names`);
});

s.check('AND STRAIGHT AND RIGHT ANGLE ARE TOLD APART BY THE DRAWING', () => {
  // Not merely by a field. Otherwise they are one part with two names and the
  // picture cannot say which you fitted — which is the whole reason Peter asked
  // for a shape of their own rather than reusing the pin header.
  const board = { schema: 'stripex/1', board: { cols: 20, rows: 12, pattern: 'strip' },
    breaks: [], wires: [], placements: [] };
  const draw = (id) => R.renderBoard(
    { ...board, placements: [D.placementFor(id, { col: 3, row: 3 }, 0, 'J1')] }, {},
  );
  const a = draw('jst-xh-4-straight');
  const b = draw('jst-xh-4-right');
  const body = (svg) => (String(svg).match(/<[^>]*data-kind="part-body"[^>]*>/) ?? [''])[0];
  ok(body(a), 'the straight one has a body');
  ok(body(a) !== body(b), `the two are drawn differently:\n  ${body(a)}\n  ${body(b)}`);
});

// ------------------------------------------ the shroud follows its pins
// Governed by docs/specs/jst-rotation.md
//
// GEOMETRIC, not structural. "Is there a rotate() in the output" would pass on a
// rotated group of entirely the wrong size, which is exactly the defect: at rot
// 90 the shroud collapsed onto pin 1 and the other three pins sat outside it.

// The rect drawn for this placement, with its group's transform resolved, as
// four corners in board millimetres.
function bodyCorners(pl) {
  const svg = String(R.renderBoard({
    schema: 'stripex/1', board: { cols: 30, rows: 24, pattern: 'strip' },
    breaks: [], wires: [], placements: [pl],
  }, {}));
  const chunk = svg.slice(svg.indexOf(`data-ref="${pl.ref}"`));
  const rect = /<rect[^>]*data-kind="part-body"[^>]*>/.exec(chunk)?.[0];
  if (!rect) return null;
  const num = (src, name) => Number((new RegExp(`${name}="(-?[\\d.]+)"`).exec(src) ?? [])[1]);
  const x = num(rect, 'x'); const y = num(rect, 'y');
  const w = num(rect, 'width'); const h = num(rect, 'height');
  // The nearest enclosing group transform, if any.
  const before = chunk.slice(0, chunk.indexOf(rect));
  const tf = [...before.matchAll(/<g transform="translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)"/g)].pop();
  const [tx, ty, deg] = tf ? [Number(tf[1]), Number(tf[2]), Number(tf[3])] : [0, 0, 0];
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad); const sin = Math.sin(rad);
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    .map(([px, py]) => ({ x: tx + px * cos - py * sin, y: ty + px * sin + py * cos }));
}

// Is a point inside the (convex, four-cornered) shroud? Sign of the cross
// product against each edge, all the same way round.
function inside(pt, corners) {
  let sign = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i]; const b = corners[(i + 1) % corners.length];
    const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

s.check('A ROTATED CONNECTOR STILL COVERS ITS OWN PINS', () => {
  // Measured before the fix, in Chromium: a 4-way at rot 0 drew 172x49 px and
  // the same part at rot 90 drew 43x49 — a box around pin 1.
  for (const id of ['jst-xh-2-straight', 'jst-xh-4-straight', 'jst-xh-8-straight',
    'jst-xh-4-right', 'jst-xh-8-right']) {
    for (const rotDeg of [0, 90, 180, 270]) {
      const pl = D.placementFor(id, { col: 10, row: 10 }, rotDeg, 'J1');
      const corners = bodyCorners(pl);
      ok(corners, `${id} @${rotDeg}: a body is drawn`);
      const pins = rot.resolvePins([pl], lib.getPart);
      for (const p of pins) {
        const at = geom.holeToMm(p.col, p.row);
        ok(inside(at, corners),
          `${id} @${rotDeg}: pin ${p.pin} at (${p.col},${p.row}) is inside its own shroud`);
      }
    }
  }
});

s.check('and the shroud is longer along the pins than across them', () => {
  // A collapsed body can still contain one pin. This says it did not collapse.
  for (const rotDeg of [0, 90, 180, 270]) {
    const c = bodyCorners(D.placementFor('jst-xh-8-straight', { col: 10, row: 10 }, rotDeg, 'J1'));
    const side = (a, b) => Math.hypot(c[b].x - c[a].x, c[b].y - c[a].y);
    const along = Math.max(side(0, 1), side(1, 2));
    const across = Math.min(side(0, 1), side(1, 2));
    ok(along > across * 3, `@${rotDeg}: ${along.toFixed(1)} mm long by ${across.toFixed(1)} across`);
  }
});

s.check('straight and right angle stay different at every rotation', () => {
  for (const rotDeg of [0, 90, 180, 270]) {
    const a = bodyCorners(D.placementFor('jst-xh-4-straight', { col: 10, row: 10 }, rotDeg, 'J1'));
    const b = bodyCorners(D.placementFor('jst-xh-4-right', { col: 10, row: 10 }, rotDeg, 'J1'));
    ok(JSON.stringify(a) !== JSON.stringify(b), `@${rotDeg}: still told apart`);
  }
});

s.check('and the ramp says which face the cable enters', () => {
  const board = { schema: 'stripex/1', board: { cols: 20, rows: 12, pattern: 'strip' },
    breaks: [], wires: [], placements: [D.placementFor('jst-xh-4-straight', { col: 3, row: 3 }, 0, 'J1')] };
  const svg = String(R.renderBoard(board, {}));
  ok(svg.includes('data-kind="jst-ramp"'), 'the locking ramp is drawn');
});

s.check('EVERY DEVICE IS PLACEABLE AND CARRIES ITS NAMES', () => {
  for (const d of Object.values(D.DEVICES)) {
    const pl = D.placementFor(d.id, { col: 2, row: 2 }, 0, 'X1');
    ok(pl, `${d.id} places`);
    eq(pl.pinNames, d.pins, `${d.id} carries its names`);
    const pins = rot.resolvePins([pl], lib.getPart);
    eq(pins.map((p) => p.pin), d.pins, `${d.id}: the names reach the resolved pins`);
  }
});

// ------------------------------------------------ a pin says its own name
// Governed by docs/specs/pin-names-layer.md

const pinNameEls = (svg) => [...String(svg).matchAll(
  /<text[^>]*data-kind="pin-name"[^>]*>([^<]*)<\/text>/g,
)].map((m) => ({ tag: m[0], text: m[1] }));

const withXiao = (opts) => R.renderBoard({
  schema: 'stripex/1', board: { cols: 25, rows: 20, pattern: 'strip' },
  breaks: [], wires: [],
  placements: [D.placementFor('xiao', { col: 4, row: 10 }, 0, 'U1')],
}, opts);

s.check('THE LAYER IS OFF UNTIL YOU ASK FOR IT', () => {
  // Every other layer is on because it draws something the board HAS. This one
  // draws an annotation, and turning it on is the deliberate act of "now I am
  // wiring". An existing board must open looking as it did.
  eq(R.DEFAULT_LAYERS.pinNames, false, 'off by default');
  eq(pinNameEls(withXiao({})).length, 0, 'and nothing is drawn');
});

s.check('A XIAO NAMES ALL FOURTEEN OF ITS PINS', () => {
  // The names were already carried, resolved and quoted by the DRC. Nothing drew
  // them, so finding D4 meant counting pads — at the exact moment you are
  // looking at the board rather than a datasheet.
  const names = pinNameEls(withXiao({ layers: { pinNames: true } })).map((e) => e.text);
  eq(names.length, 14, 'fourteen');
  eq(names.sort(), [...D.getDevice('xiao').pins].sort(), 'and they are its own names');
});

s.check('EACH NAME SITS BESIDE ITS PAD, NOT ON IT', () => {
  // The pad is what you are aiming at; a name on top of it is in the way of the
  // click it exists to help you make.
  const svg = String(withXiao({ layers: { pinNames: true } }));
  const pads = [...svg.matchAll(/<(?:rect|circle)[^>]*data-kind="pad"[^>]*>/g)].map((m) => m[0]);
  ok(pads.length === 14, `fourteen pads: ${pads.length}`);
  const num = (tag, name) => Number((new RegExp(`${name}="(-?[\\d.]+)"`).exec(tag) ?? [])[1]);
  const padAt = pads.map((p) => ({
    x: Number.isNaN(num(p, 'cx')) ? num(p, 'x') + R.PAD_R_MM : num(p, 'cx'),
    y: Number.isNaN(num(p, 'cy')) ? num(p, 'y') + R.PAD_R_MM : num(p, 'cy'),
  }));
  for (const el of pinNameEls(svg)) {
    const x = num(el.tag, 'x');
    const y = num(el.tag, 'y');
    const near = padAt.reduce((best, p) => {
      const d = Math.hypot(p.x - x, p.y - y);
      return d < best.d ? { d, p } : best;
    }, { d: Infinity, p: null });
    ok(near.d >= R.PAD_R_MM,
      `${el.text} is ${near.d.toFixed(2)} mm from its pad, at least ${R.PAD_R_MM}`);
  }
});

s.check('and it goes on the side AWAY from the package', () => {
  // Derived from the shape of the pin field, not from the rotation, so it
  // follows a part around. A DIL's rows separate vertically at rot 0 and
  // horizontally at 90 — the outward direction is along whichever axis that is.
  const pl = D.placementFor('xiao', { col: 4, row: 10 }, 0, 'U1');
  const pins = rot.resolvePins([pl], lib.getPart);
  const pts = pins.map((p) => geom.holeToMm(p.col, p.row));
  const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
  for (const pt of pts) {
    const place = R.pinNamePlacement(pt, pts);
    if (pt.y > cy) ok(place.y > pt.y, `a pin below the centre puts its name below it`);
    else ok(place.y < pt.y, `a pin above the centre puts its name above it`);
  }
});

s.check('and turning the part sideways turns the names with it', () => {
  // rot 90 makes the rows separate horizontally, so the names go left and right
  // and anchor outward — with no case in the code for "90".
  const pl = D.placementFor('xiao', { col: 10, row: 4 }, 90, 'U1');
  const pins = rot.resolvePins([pl], lib.getPart);
  const pts = pins.map((p) => geom.holeToMm(p.col, p.row));
  const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
  const anchors = new Set(pts.map((pt) => R.pinNamePlacement(pt, pts).anchor));
  ok(anchors.has('start') && anchors.has('end'),
    `anchored outward on both sides: ${[...anchors].join(' ')}`);
  for (const pt of pts) {
    const place = R.pinNamePlacement(pt, pts);
    if (pt.x > cx) ok(place.x > pt.x, 'a pin right of centre puts its name to the right');
    else ok(place.x < pt.x, 'a pin left of centre puts its name to the left');
  }
});

s.check('a generic part names its pins too', () => {
  // Not a device-only feature: a DIP's pins are numbered and the numbers are
  // just as much what you need while wiring.
  const svg = R.renderBoard({
    schema: 'stripex/1', board: { cols: 25, rows: 20, pattern: 'strip' },
    breaks: [], wires: [],
    placements: [{ ref: 'U9', part: 'dip', at: { col: 4, row: 10 }, rot: 0, span: 7, width: 3 }],
  }, { layers: { pinNames: true } });
  eq(pinNameEls(svg).length, 14, 'fourteen numbered pins');
});

s.check('and the pin-name layer is independent of the other label layers', () => {
  const on = { layers: { pinNames: true, labels: false } };
  ok(pinNameEls(withXiao(on)).length > 0, 'pin names survive labels being off');
  const off = { layers: { pinNames: false, labels: true } };
  eq(pinNameEls(withXiao(off)).length, 0, 'and go when their own layer goes');
  ok(String(withXiao(off)).includes('data-kind="part-label"'), 'while the ref stays');
});

process.exit((await s.run()) ? 0 : 1);
