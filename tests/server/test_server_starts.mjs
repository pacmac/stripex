// The server must actually start.
//
// Every other server check imports `app` and drives it in-process, which
// evaluates the module completely before anything is called. Running it as the
// ENTRY POINT does not: the listen block runs partway down the file, so a
// reference to something declared below it is a temporal dead zone that only
// bites the real server.
//
// That is exactly what happened: attachLive was called from the listen block
// above `let live = null`, 48 suites passed, and the server would not boot.
// tests/render/test_boot.mjs was written for this class of fault in app.js;
// nothing covered the server.

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, eq, ok } from '../run.mjs';

const s = suite('server-starts');

const root = fileURLToPath(new URL('../../', import.meta.url));

// Start it exactly as a person would, on a port nothing else is using.
function start(port) {
  return new Promise((resolve) => {
    // main.js, the real entry — the one pm2 runs. Spawning index.js would have
    // tested a path nothing uses, and index.js is deliberately no longer able to
    // start itself.
    const child = spawn(process.execPath, ['src/server/main.js'], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        STRIPEX_BOARDS_DIR: mkdtempSync(join(tmpdir(), 'stripex-start-')),
      },
    });
    let out = '';
    const done = (result) => resolve({ ...result, out, child });
    child.stdout.on('data', (d) => {
      out += d;
      if (/listening/i.test(out)) done({ listening: true });
    });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => done({ listening: false, code }));
    setTimeout(() => done({ listening: false, code: 'timeout' }), 6000);
  });
}

const port = 3400 + Math.floor(Math.random() * 400);
const started = await start(port);

s.check('THE SERVER STARTS AS AN ENTRY POINT', () => {
  // Not "the module imports". A temporal dead zone in the listen path is
  // invisible to every check that imports `app` and calls things afterwards.
  ok(started.listening,
    `it printed "listening": exit=${started.code}\n${String(started.out).slice(0, 500)}`);
});

s.check('and it serves the editor and the board list', async () => {
  if (!started.listening) return ok(false, 'it never started');
  const page = await fetch(`http://127.0.0.1:${port}/`);
  eq(page.status, 200, 'the editor is served');
  const boards = await fetch(`http://127.0.0.1:${port}/api/boards`);
  eq(boards.status, 200, 'and the board list answers');
  return ok(true, 'both');
});

s.check('and it accepts a live feed connection', async () => {
  // The feed is part of starting, not an extra: a server that boots without it
  // is a server whose screens go quietly stale.
  if (!started.listening) return ok(false, 'it never started');
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live`);
  const greeted = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 4000);
    ws.on('message', (m) => {
      clearTimeout(t);
      try { resolve(JSON.parse(String(m)).type === 'hello'); } catch { resolve(false); }
    });
    ws.on('error', () => { clearTimeout(t); resolve(false); });
  });
  try { ws.close(); } catch { /* going anyway */ }
  return ok(greeted, 'the feed greeted us');
});

const okAll = await s.run();
try { started.child?.kill(); } catch { /* already gone */ }
process.exit(okAll ? 0 : 1);
