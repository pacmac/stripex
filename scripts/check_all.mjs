// Runs every check file under tests/ and reports one line per suite plus a total.
// Exits non-zero if any suite failed, so `npm run check` is usable as a gate.

import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function findTests(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await findTests(full));
    else if (e.name.startsWith('test_') && e.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const run = (file) => new Promise((resolve) => {
  const p = spawn(process.execPath, [file], { cwd: root });
  let buf = '';
  p.stdout.on('data', (d) => { buf += d; });
  p.stderr.on('data', (d) => { buf += d; });
  p.on('close', (code) => resolve({ file, code, out: buf }));
});

const files = (await findTests(path.join(root, 'tests'))).sort();
const results = await Promise.all(files.map(run));

let failed = 0;
for (const r of results) {
  if (r.code !== 0) {
    failed += 1;
    process.stdout.write(r.out);
  } else {
    const line = r.out.trim().split('\n').filter(Boolean).pop() ?? '(no output)';
    console.log(line);
  }
}
console.log(`${files.length - failed}/${files.length} suites passed`);
process.exit(failed === 0 ? 0 : 1);
