// Adding and correcting a component over HTTP.
// Governed by docs/specs/component-editor.md
//
// The half of the component editor that has nothing to do with a screen: Peter
// can define a component, or correct one of mine, and it takes effect on the
// boards he builds next — without either of us editing source.

import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok, softImport } from '../run.mjs';

const dir = mkdtempSync(join(tmpdir(), 'stripex-devapi-'));
process.env.STRIPEX_BOARDS_DIR = dir;
process.env.STRIPEX_DEVICES_FILE = join(dir, 'devices.json');

const s = suite('api-device-edit');

const mod = await softImport('../../src/server/index.js', import.meta.url);

const server = createServer(mod.app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const api = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* optional */ }
  return { status: res.status, body: json };
};

const EEPROM = {
  name: '24LC256 EEPROM',
  category: 'ic',
  base: 'dip',
  span: 4,
  width: 3,
  refPrefix: 'U',
  pinSource: 'read off the part',
  pins: ['A0', 'A1', 'A2', 'VSS', 'SDA', 'SCL', 'WP', 'VCC'],
};

s.check('THE CATALOGUE STARTS AS THE BUILT-INS, WITH NO FILE', async () => {
  ok(!existsSync(process.env.STRIPEX_DEVICES_FILE), 'nothing is stored yet');
  const r = await api('GET', '/api/devices');
  eq(r.status, 200, 'it answered');
  ok(r.body.devices.length >= 16, `and the catalogue is complete: ${r.body.devices.length}`);
  ok(r.body.devices.every((d) => d.builtIn), 'every one of them stock');
});

s.check('A NEW COMPONENT IS ADDED AND STAYS', async () => {
  const put = await api('PUT', '/api/devices/my-eeprom', { device: EEPROM });
  eq(put.status, 200, `created: ${JSON.stringify(put.body).slice(0, 160)}`);
  eq(put.body.builtIn, false, 'it is not stock');

  const list = await api('GET', '/api/devices');
  const mine = list.body.devices.find((d) => d.id === 'my-eeprom');
  ok(mine, 'it is in the catalogue');
  eq(mine.pins, 8, 'with its eight pins');
  ok(existsSync(process.env.STRIPEX_DEVICES_FILE), 'and it is on disk');
});

s.check('AND CAN BE PLACED ON A BOARD, WHICH IS THE POINT', async () => {
  const made = await api('POST', '/api/boards', { name: 'dev test', cols: 20, rows: 14 });
  eq(made.status, 201, 'a board to put it on');
  const r = await api('POST', `/api/boards/${made.body.slug}/ops`, {
    ops: [{ op: 'addPart', device: 'my-eeprom', at: { col: 4, row: 4 }, rot: 90 }],
  });
  eq(r.status, 200, `placed: ${JSON.stringify(r.body).slice(0, 200)}`);

  const board = await api('GET', `/api/boards/${made.body.slug}`);
  const pl = board.body.project.placements[0];
  eq(pl.device, 'my-eeprom', 'the placement names it');
  eq(pl.pinNames, EEPROM.pins, 'and carries the names it was given');
});

s.check('A BUILT-IN CAN BE CORRECTED', async () => {
  // How NC3 and NC4 get settled without me.
  const stock = await api('GET', '/api/devices/tmc2209');
  eq(stock.body.builtIn, true, 'the TMC2209 starts stock');
  const pins = [...stock.body.device.pins];
  pins[2] = 'DIAG';
  pins[3] = 'INDEX';

  const put = await api('PUT', '/api/devices/tmc2209', {
    device: { ...stock.body.device, pins, unverifiedPins: [] },
  });
  eq(put.status, 200, `corrected: ${JSON.stringify(put.body).slice(0, 160)}`);
  eq(put.body.device.pins[2], 'DIAG', 'the new name is in the catalogue');
  eq(put.body.builtIn, false, 'and it is no longer stock');
});

s.check('and dropping the correction returns it to stock', async () => {
  const gone = await api('DELETE', '/api/devices/tmc2209');
  eq(gone.status, 200, 'dropped');
  eq(gone.body.builtIn, true, 'stock again');
  eq(gone.body.device.pins[2], 'NC3', 'with the built-in name back');
});

s.check('AN INVALID COMPONENT IS REFUSED, NAMING WHAT IS WRONG', async () => {
  const cases = [
    [{ ...EEPROM, base: 'nonsense' }, /nonsense|base/i],
    [{ ...EEPROM, pins: ['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G'] }, /twice|duplicate/i],
    [{ ...EEPROM, pins: ['A', 'B'] }, /8|2|pin/i],
    [{ ...EEPROM, span: 0 }, /span/i],
  ];
  for (const [device, expect] of cases) {
    const r = await api('PUT', '/api/devices/bad-one', { device });
    eq(r.status, 400, `refused: ${JSON.stringify(device).slice(0, 60)}`);
    ok(expect.test(r.body.error), `and says why: ${r.body.error}`);
  }
  const list = await api('GET', '/api/devices');
  ok(!list.body.devices.some((d) => d.id === 'bad-one'), 'and none of them was stored');
});

s.check('a device that is not there is a 404', async () => {
  eq((await api('GET', '/api/devices/nope')).status, 404, 'GET');
  eq((await api('DELETE', '/api/devices/nope')).status, 404, 'DELETE');
});

s.check('EDITING A COMPONENT DOES NOT CHANGE A BOARD ALREADY BUILT', async () => {
  // The rule that makes a component editor safe at all: a placement copied what
  // it needed, so the board Peter soldered from does not change under him.
  const board = await api('GET', '/api/boards/dev-test');
  const before = board.body.project.placements[0].pinNames;

  await api('PUT', '/api/devices/my-eeprom', {
    device: { ...EEPROM, pins: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7', 'Z8'] },
  });

  const after = await api('GET', '/api/boards/dev-test');
  eq(after.body.project.placements[0].pinNames, before, 'the board keeps the names it was built with');
  const now = await api('GET', '/api/devices/my-eeprom');
  eq(now.body.device.pins[0], 'Z1', 'while the catalogue has moved on');
});

const okAll = await s.run();
server.close();
process.exit(okAll ? 0 : 1);
