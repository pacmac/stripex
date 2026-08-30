// Can v5 build a board through the API? Measured, not asserted.
// Governed by docs/specs/device-aware-api.md

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok, softImport } from '../run.mjs';

const s = suite('api-devices');

process.env.STRIPEX_BOARDS_DIR = mkdtempSync(join(tmpdir(), 'stripex-apidev-'));
const mod = await softImport('../../src/server/index.js', import.meta.url);

let base = '';
let server = null;
if (mod?.app) {
  server = createServer(mod.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}

const api = async (path, opts) => {
  const res = await fetch(base + path, {
    headers: { 'content-type': 'application/json' }, ...opts,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

s.check('THE DEVICES CAN BE DISCOVERED', async () => {
  // /api/parts existed; devices never got the same, so a caller had no way to
  // learn that xiao, tmc2209 and the JST family exist at all.
  const r = await api('/api/devices');
  eq(r.status, 200, 'the route answers');
  const ids = (r.body.devices ?? r.body).map((d) => d.id);
  ok(ids.includes('xiao'), `xiao is listed: ${ids.slice(0, 5).join(' ')}`);
  ok(ids.includes('tmc2209'), 'and the TMC2209');
  ok(ids.some((id) => id.startsWith('jst-xh')), 'and the JST family');
});

s.check('and says which pins are unverified', async () => {
  // A caller wiring to a pin deserves to know the name has not been checked.
  const r = await api('/api/devices');
  const tmc = (r.body.devices ?? r.body).find((d) => d.id === 'tmc2209');
  eq(tmc.pins, 16, 'sixteen pins');
  eq(tmc.unverifiedPins, ['NC3', 'NC4'], 'and the two that were not sourced');
});

s.check('A DEVICE PLACED BY API IS THE DEVICE, NOT ITS FOOTPRINT', async () => {
  // Measured before this: addPart {device:'xiao'} gave span 7, width 3, and
  // zero pin names — the DIP defaults. A XIAO is 7 x 6 with fourteen names, and
  // placing it wrong is what the catalogue exists to prevent.
  await api('/api/boards', { method: 'POST', body: JSON.stringify({ name: 'Dev One', cols: 25, rows: 20 }) });
  const cur = await api('/api/boards/dev-one');
  const r = await api('/api/boards/dev-one/ops', {
    method: 'POST',
    body: JSON.stringify({
      version: cur.body.version,
      ops: [{ op: 'addPart', device: 'xiao', at: { col: 4, row: 3 }, rot: 90 }],
    }),
  });
  eq(r.status, 200, `placed: ${JSON.stringify(r.body).slice(0, 120)}`);
  const after = await api('/api/boards/dev-one');
  const pl = after.body.project.placements[0];
  eq(pl.span, 7, 'seven a side');
  eq(pl.width, 6, 'rows six holes apart, not the DIP default of three');
  eq(pl.pinNames?.length, 14, 'and its fourteen names');
  eq(pl.device, 'xiao', 'tagged as the device it came from');
});

s.check('and a TMC2209 brings its own size, silk and cut setting', async () => {
  const cur = await api('/api/boards/dev-one');
  await api('/api/boards/dev-one/ops', {
    method: 'POST',
    body: JSON.stringify({
      version: cur.body.version,
      ops: [{ op: 'addPart', device: 'tmc2209', at: { col: 14, row: 3 }, rot: 90 }],
    }),
  });
  const after = await api('/api/boards/dev-one');
  const pl = after.body.project.placements.find((x) => x.device === 'tmc2209');
  eq(pl.span, 8, 'eight a side');
  eq(pl.width, 5, 'rows 12.7 mm apart');
  eq(pl.pinNames?.length, 16, 'sixteen names');
  eq(pl.autoBreak, false, 'and it cuts its own strips only when told');
  ok(pl.silk, 'with its silk colour');
});

s.check('an unknown device is refused by name', async () => {
  // Rather than silently placed as a bare footprint, which is the failure this
  // whole check exists for.
  const cur = await api('/api/boards/dev-one');
  const r = await api('/api/boards/dev-one/ops', {
    method: 'POST',
    body: JSON.stringify({
      version: cur.body.version,
      ops: [{ op: 'addPart', device: 'unobtainium', at: { col: 2, row: 2 } }],
    }),
  });
  eq(r.status, 400, 'refused');
  ok(/unobtainium/.test(r.body.error), `naming it: ${r.body.error}`);
});

s.check('FREE HOLES CAN BE ASKED FOR', async () => {
  // The query that decides where a wire may land. Written three times in scratch
  // scripts and wrong twice, and there was no route to the right one.
  // BY NAME, because a device carries names — there is no pin "3" on a XIAO,
  // and asking for one is a 404 rather than an empty list.
  const numbered = await api('/api/boards/dev-one/free-holes?ref=U1&pin=3');
  eq(numbered.status, 404, 'a XIAO has no pin 3; it has D0..D10, 3V3, GND and 5V');
  const r = await api('/api/boards/dev-one/free-holes?ref=U1&pin=D4');
  eq(r.status, 200, `the route answers for a real pin: ${JSON.stringify(r.body).slice(0, 80)}`);
  const holes = r.body.holes ?? r.body;
  ok(Array.isArray(holes) && holes.length > 0, `some holes: ${JSON.stringify(holes).slice(0, 80)}`);
  ok(holes.every((h) => Number.isInteger(h.col) && Number.isInteger(h.row)), 'each a hole');
});

s.check('and never includes the pin’s own hole', async () => {
  const board = (await api('/api/boards/dev-one')).body.project;
  const { resolvePins } = await import('../../src/model/rotate.js');
  const { getPart } = await import('../../src/parts/library.js');
  const pin = resolvePins(board.placements, getPart)
    .find((x) => x.ref === 'U1' && String(x.pin) === 'D2');
  ok(pin, 'the pin resolves by its NAME, because the device carries names');
  const holes = (await api('/api/boards/dev-one/free-holes?ref=U1&pin=D2')).body.holes;
  ok(!holes.some((h) => h.col === pin.col && h.row === pin.row),
    'the pin sits in its own hole and cannot also be free');
});

s.check('a pin that is not there is a 404, not an empty list', async () => {
  // An empty list reads as "nowhere to put it" and sends a caller looking for a
  // routing problem that does not exist.
  const r = await api('/api/boards/dev-one/free-holes?ref=U1&pin=NOPE');
  eq(r.status, 404, `refused: ${JSON.stringify(r.body)}`);
});

s.check('A ROTATOR BOARD, BUILT THROUGH THE API ALONE', async () => {
  // The question Peter asked. Create it, place his two modules BY NAME, ask
  // where a wire may land, and wire it — with nothing but HTTP.
  await api('/api/boards', { method: 'POST', body: JSON.stringify({ name: 'By Api', cols: 25, rows: 20 }) });
  let cur = await api('/api/boards/by-api');
  const placed = await api('/api/boards/by-api/ops', {
    method: 'POST',
    body: JSON.stringify({
      version: cur.body.version,
      ops: [
        { op: 'addPart', device: 'xiao', at: { col: 4, row: 3 }, rot: 90 },
        { op: 'addPart', device: 'tmc2209', at: { col: 4, row: 11 }, rot: 90 },
      ],
    }),
  });
  eq(placed.status, 200, 'both modules placed');

  // Where may a wire land, at each end?
  const from = (await api('/api/boards/by-api/free-holes?ref=U1&pin=D2')).body.holes;
  const to = (await api('/api/boards/by-api/free-holes?ref=U2&pin=STEP')).body.holes;
  ok(from.length && to.length, 'both ends have somewhere to go');

  cur = await api('/api/boards/by-api');
  const wired = await api('/api/boards/by-api/ops', {
    method: 'POST',
    body: JSON.stringify({
      version: cur.body.version,
      ops: [{ op: 'addWire', from: from[0], to: to[0] }],
    }),
  });
  eq(wired.status, 200, `wired: ${JSON.stringify(wired.body).slice(0, 120)}`);

  // And the board reads back with REAL pin names on it.
  const board = (await api('/api/boards/by-api')).body.project;
  const xiao = board.placements.find((x) => x.device === 'xiao');
  ok(xiao.pinNames.includes('D2'), 'the XIAO knows its own pins');
  const tmc = board.placements.find((x) => x.device === 'tmc2209');
  ok(tmc.pinNames.includes('STEP') && tmc.pinNames.includes('EN'), 'and the driver knows its own');
  eq(board.wires.length, 1, 'with a wire between them');
});

const okAll = await s.run();
if (server) { mod?.closeLive?.(); server.close(); }
process.exit(okAll ? 0 : 1);
