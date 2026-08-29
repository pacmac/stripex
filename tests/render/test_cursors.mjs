// The cursor over the board must say which tool is armed.
// Governed by docs/specs/tool-cursors.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const cur = await softImport('../../src/render/cursors.js', here);

const s = suite('cursors');

s.check('THE PLACE TOOL GIVES A CROSSHAIR', () => {
  eq(cur.cursorFor('place'), 'crosshair', 'place');
});

s.check('so do the other two tools that aim at a point', () => {
  eq(cur.cursorFor('break'), 'crosshair', 'break');
  eq(cur.cursorFor('wire'), 'crosshair', 'wire');
});

s.check('the tools that target an object keep an ordinary pointer', () => {
  ok(cur.cursorFor('select') !== 'crosshair', 'select is not a crosshair');
  ok(cur.cursorFor('delete') !== 'crosshair', 'delete is not a crosshair');
});

s.check('AN UNKNOWN TOOL FALLS BACK RATHER THAN RETURNING NOTHING', () => {
  // Returning undefined would assign nothing and leave whichever cursor was set
  // last, so the board would keep a crosshair after switching to select.
  for (const t of ['nonsense', '', null, undefined]) {
    const v = cur.cursorFor(t);
    ok(typeof v === 'string' && v.length > 0, `cursorFor(${JSON.stringify(t)}) is a string`);
  }
  eq(cur.cursorFor('nonsense'), 'default', 'unknown tool');
});

s.check('every value is a real CSS cursor keyword', () => {
  const legal = new Set(['default', 'crosshair', 'pointer', 'grab', 'cell', 'move', 'text']);
  for (const t of ['select', 'place', 'break', 'wire', 'delete', 'nonsense']) {
    ok(legal.has(cur.cursorFor(t)), `${t} -> ${cur.cursorFor(t)} is a known keyword`);
  }
});

s.check('the mapping is exhaustive over the toolbar', () => {
  // Every tool the toolbar can arm must have an answer, so adding a tool without
  // a cursor is caught here rather than seen as a stuck crosshair.
  eq(Object.keys(cur.CURSORS).sort(), ['break', 'delete', 'place', 'select', 'wire'],
    'CURSORS covers exactly the five tools');
});

process.exit((await s.run()) ? 0 : 1);
