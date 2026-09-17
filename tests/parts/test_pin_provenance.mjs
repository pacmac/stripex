// A pin name is either verified or it says it is not.
// Governed by docs/specs/verified-pin-names.md
//
// tmc2209 has carried unverifiedPins: ['NC3','NC4'] since it was added and
// nothing ever checked them. I went to verify them this session and could not:
// Watterott's own pin-config page has no pin called CLK at all and does not name
// the positions an A4988 uses for RST and SLP, and RepRap's page carries six
// different module pinouts while saying DIAG, INDEX and VREF are the pins most
// likely to differ by manufacturer.
//
// So there is no correct answer to "what is TMC2209 pin 3" — only "what is pin 3
// on the module Peter has". Guessing it and clearing the flag would turn an
// honest unknown into a confident error on a board somebody solders.
//
// What CAN be fixed is that the unknown was invisible: the board drew an
// unchecked name exactly like a checked one, and no device said where its names
// came from.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const D = await softImport('../../src/parts/devices.js', here);
const O = await softImport('../../src/model/ops.js', here);
const R = await softImport('../../src/render/svg.js', here);
const boardm = await softImport('../../src/model/board.js', here);
const rot = await softImport('../../src/model/rotate.js', here);
const lib = await softImport('../../src/parts/library.js', here);

const s = suite('pin-provenance');

const devices = () => Object.values(D.DEVICES);

// ------------------------------------------------- provenance

s.check('EVERY DEVICE SAYS WHERE ITS PIN NAMES CAME FROM', () => {
  // A name with no provenance is a name nobody can check. It is the difference
  // between "read off a v2.0 board file in pad order" and "I typed it".
  const missing = devices().filter((d) => d.pins?.length && !d.pinSource).map((d) => d.id);
  eq(missing, [], `devices with pin names and no source: ${missing.join(', ')}`);
});

s.check('and an unverified pin is a pin that device actually has', () => {
  // The flag drifting from the list it points at would be worse than no flag:
  // it would mark nothing while reading as protection.
  for (const d of devices()) {
    for (const name of d.unverifiedPins ?? []) {
      ok(d.pins.includes(name),
        `${d.id} flags ${name}, which is not one of its pins: ${d.pins.join(' ')}`);
    }
  }
});

s.check('and the TMC2209 still admits it does not know two of them', () => {
  // The point of the spec, stated as a check so a later session cannot quietly
  // clear the flag from a web page describing a different module.
  const t = D.getDevice('tmc2209');
  eq(t.unverifiedPins, ['NC3', 'NC4'], 'the two unsourced positions stay flagged');
  ok(/board file|pad order/i.test(t.pinSource), `and the rest are sourced: ${t.pinSource}`);
});

s.check('a placement carries the flag, not just the catalogue', () => {
  // placementFor copies the catalogue ONTO the placement — a placement owes the
  // catalogue nothing — so the flag has to travel with the names or the board
  // cannot draw it.
  const pl = D.placementFor('tmc2209', { col: 2, row: 2 }, 0, 'U1');
  eq(pl.unverifiedPins, ['NC3', 'NC4'], 'the placement knows which names are doubtful');
});

// ------------------------------------------------- it is visible

s.check('AN UNVERIFIED PIN NAME IS DRAWN AS UNVERIFIED', () => {
  // It was drawn exactly like a checked one, so the only place the doubt existed
  // was a catalogue field nobody opens.
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.placements.push(D.placementFor('tmc2209', { col: 3, row: 2 }, 0, 'U1'));
  const svg = R.renderBoard(p, { layers: { ...R.DEFAULT_LAYERS, pinNames: true } });

  const nc3 = /<text[^>]*data-pin="NC3"[^>]*>/.exec(svg)?.[0] ?? '';
  const dir = /<text[^>]*data-pin="DIR"[^>]*>/.exec(svg)?.[0] ?? '';
  ok(nc3, 'NC3 is drawn');
  ok(dir, 'DIR is drawn');
  ok(/data-unverified="true"/.test(nc3), `NC3 says it is unverified: ${nc3}`);
  ok(!/data-unverified="true"/.test(dir), `DIR does not: ${dir}`);
  ok(nc3 !== dir.replace('DIR', 'NC3'), 'and the two are drawn differently');
});

// ------------------------------------------------- correcting one

s.check('setPinNames PUTS A CORRECTED NAME ON THE BOARD', () => {
  // The mechanism by which Peter's answer, when he reads his own silkscreen,
  // becomes part of the board rather than a remark in a chat log.
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.placements.push(D.placementFor('tmc2209', { col: 3, row: 2 }, 0, 'U1'));
  const names = [...p.placements[0].pinNames];
  names[2] = 'DIAG';
  names[3] = 'INDEX';

  const out = O.setPinNames(p, 'U1', names);
  ok(!out.error, `it applied: ${out.error ?? ''}`);
  const pl = out.project.placements[0];
  eq(pl.pinNames[2], 'DIAG', 'the name is corrected');
  eq(pl.unverifiedPins, [], 'and nothing is flagged any more, because it was read off the part');
  eq(D.getDevice('tmc2209').pins[2], 'NC3', 'the catalogue is untouched');
  eq(p.placements[0].pinNames[2], 'NC3', 'and so is the board it was given');
});

s.check('and is refused when the count is wrong', () => {
  const p = boardm.makeProject({ cols: 20, rows: 12 });
  p.placements.push(D.placementFor('tmc2209', { col: 3, row: 2 }, 0, 'U1'));
  const out = O.setPinNames(p, 'U1', ['ONE', 'TWO']);
  ok(out.error, 'refused');
  ok(/16|2/.test(out.error), `naming the counts: ${out.error}`);
});

s.check('and a corrected name survives a rotate and a move', () => {
  // A name that is flagged, corrected, and then vanishes on the next edit is
  // worse than no name at all.
  const p = boardm.makeProject({ cols: 24, rows: 16 });
  p.placements.push(D.placementFor('tmc2209', { col: 3, row: 2 }, 0, 'U1'));
  const names = [...p.placements[0].pinNames];
  names[2] = 'DIAG';
  let cur = O.setPinNames(p, 'U1', names).project;

  cur.placements[0].rot = 90;
  const moved = O.movePart(cur, 'U1', 'DIAG', { col: 10, row: 6 });
  ok(!moved.error, `moved by the corrected pin name: ${moved.error ?? ''}`);
  eq(moved.project.placements[0].pinNames[2], 'DIAG', 'the name survived');

  const pins = rot.resolvePins(moved.project.placements, lib.getPart);
  ok(pins.some((x) => x.pin === 'DIAG'), 'and it still resolves to a hole');
});

process.exit(await s.run() ? 0 : 1);
