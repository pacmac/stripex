// A device is numbered by its OWN reference letter, not its footprint's.
// Governed by docs/specs/device-aware-api.md (device refs)
//
// Found 2026-09-17 placing the new SOT-23 MOSFET over the API: it came back U2,
// because addPart numbered it from the sot23 package's generic U. The editor
// places through addPart too, so a mouse-placed MOSFET was U1 as well.

import { suite, eq, softImport } from '../run.mjs';

const here = import.meta.url;
const ops = await softImport('../../src/model/ops.js', here);
const dev = await softImport('../../src/parts/devices.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('device-refs');

s.check('A SOT-23 MOSFET IS Q1, THEN Q2', () => {
  let p = boardm.makeProject({ cols: 20, rows: 10 });
  const a = ops.addPart(p, { device: 'sot23-mosfet', at: { col: 2, row: 2 } });
  eq(a.ref, 'Q1', 'the first is Q1');
  p = a.project;
  const b = ops.addPart(p, { device: 'sot23-mosfet', at: { col: 8, row: 2 } });
  eq(b.ref, 'Q2', 'the second is Q2');
});

s.check('A DEVICE WITHOUT A LETTER OF ITS OWN TAKES ITS FOOTPRINT\'S', () => {
  dev.installDevices([{ id: 'ref-probe', name: 'probe', category: 'connector', base: 'header', span: 3, pins: ['A', 'B', 'C'] }]);
  try {
    const r = ops.addPart(boardm.makeProject({ cols: 20, rows: 10 }), { device: 'ref-probe', at: { col: 2, row: 2 } });
    eq(r.ref, 'J1', 'a header-based device with no letter is J1');
  } finally { dev.installDevices([]); }
});

process.exit((await s.run()) ? 0 : 1);
