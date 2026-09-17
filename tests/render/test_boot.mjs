// The editor must actually boot.
//
// Twice in one task I shipped a blank page while every suite was green:
//
//   ReferenceError: Cannot access 'loadRepairs' before initialization
//   SyntaxError:    Identifier 'effectiveBreaks' has already been declared
//
// Both are module-level faults in public/app.js. Every other suite imports the
// MODULES app.js uses and never app.js itself, so neither was visible. This one
// runs it.
//
// It is not a browser. It is a permissive DOM stub, enough to let the module
// evaluate and boot() run to the end. That catches the whole class of fault that
// stops the editor before it draws anything — import errors, temporal dead
// zones, duplicate declarations, a typo in top-level code. It does NOT prove
// the editor works, and nothing here should be read as saying so.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, eq, ok } from '../run.mjs';

const s = suite('boot');

const root = new URL('../../', import.meta.url);

// A stub that answers any property with something callable and chainable, so
// DOM code runs rather than tripping on the first unimplemented method.
function stubNode() {
  const node = {
    style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    hidden: false, value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
    children: [], files: [],
    appendChild(x) { return x; },
    insertBefore(x) { return x; },
    insertAdjacentHTML() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    querySelector: () => stubNode(),
    querySelectorAll: () => [],
    closest: () => null,
    click() {}, focus() {}, blur() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100, left: 0, top: 0 }),
  };
  return node;
}

function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

async function bootOnce(storeSeed) {
  const store = makeStore();
  if (storeSeed) store.setItem('stripex.project', JSON.stringify(storeSeed));

  globalThis.localStorage = store;
  globalThis.document = {
    ...stubNode(),
    body: stubNode(),
    documentElement: { ...stubNode(), dataset: {} },
    createElement: () => stubNode(),
    activeElement: null,
  };
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    prompt: () => null,
    addEventListener() {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  };
  globalThis.Blob = class { constructor() {} };
  globalThis.CSS = { escape: (x) => String(x) };

  // app.js imports with absolute /src/... specifiers, which the server resolves
  // and node cannot. Rewrite them to real paths and evaluate the result.
  const src = readFileSync(new URL('public/app.js', root), 'utf8')
    .replace(/from '\/src\//g, `from '${new URL('src/', root).pathname}`);
  const dir = mkdtempSync(join(tmpdir(), 'stripex-boot-'));
  const file = join(dir, 'app.mjs');
  writeFileSync(file, src);
  await import(`${file}?t=${Date.now()}`);
}

s.check('THE EDITOR BOOTS ON AN EMPTY STORE', async () => {
  let threw = null;
  try { await bootOnce(null); } catch (e) { threw = `${e.name}: ${e.message}`; }
  eq(threw, null, 'boot did not throw');
});

s.check('AND ON A STORED BOARD', async () => {
  const board = JSON.parse(readFileSync(
    new URL('recovered/original-as-saved.json', root), 'utf8',
  ));
  let threw = null;
  try { await bootOnce(board); } catch (e) { threw = `${e.name}: ${e.message}`; }
  eq(threw, null, "boot did not throw on Peter's board");
});

s.check('every source file is at least syntactically valid', async () => {
  // node --check catches an early error such as a duplicate declaration, which
  // is one of the two faults that shipped. It does NOT catch a temporal dead
  // zone — that needs the module actually evaluated, which the checks above do.
  const { execFileSync } = await import('node:child_process');
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.m?js$/.test(name) ? [full] : [];
  });
  const files = [
    ...walk(new URL('src', root).pathname),
    ...walk(new URL('public', root).pathname),
  ];
  ok(files.length > 10, `${files.length} files checked`);
  for (const f of files) {
    let err = null;
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
    catch (e) { err = String(e.stderr).split('\n').find((l) => /Error/.test(l)); }
    eq(err, null, `${f.replace(new URL('', root).pathname, '')}`);
  }
});

process.exit((await s.run()) ? 0 : 1);
