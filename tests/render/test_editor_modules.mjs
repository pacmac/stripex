// The editor is modules, not one file.
// Governed by docs/specs/architecture-for-netlist.md
//
// Peter, 2026-08-30: "I plan on adding a lot of new features ... does the
// current architecture etc CLEAN and does it support extending the
// functionality easily?" The measured answer named public/app.js: state and
// persistence, every mutation, every panel painter and all the event wiring in
// one file. The limit here is what makes that answer stop being true.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, eq, ok } from '../run.mjs';

const s = suite('editor-modules');

const dir = new URL('../../public/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
const lines = (f) => readFileSync(join(dir, f), 'utf8').split('\n').length;

// About 400: a file a person can hold in their head, and the number the
// register entry states. A few lines over is not a finding, 3358 is.
const LIMIT = 420;

s.check('NO EDITOR FILE IS LONGER THAN ABOUT 400 LINES', () => {
  const over = files.map((f) => [f, lines(f)]).filter(([, n]) => n > LIMIT)
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `${f}: ${n}`);
  eq(over, [], 'every file in public/ is under the limit');
});

s.check('THE PRINT VIEW IS ITS OWN MODULE', () => {
  ok(files.includes('print-view.js'), `public/print-view.js exists: ${files.join(', ')}`);
  if (!files.includes('print-view.js')) return;
  const app = readFileSync(join(dir, 'app.js'), 'utf8');
  ok(/from '\.\/print-view\.js'/.test(app), 'and app.js imports it');
  ok(!/function printSheetHtml/.test(app), 'the sheet is built in the module, not in app.js');
});

process.exit((await s.run()) ? 0 : 1);
