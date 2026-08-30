// The file is the board, and everybody watching is told when it changes.
// Governed by docs/specs/live-board-feed.md
//
// Four bugs this session came from one cause: nothing told the browser the file
// had changed, so everything that tried to guess it afterwards was wrong at
// least once, and Peter lost work to two of them.

import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok, softImport } from '../run.mjs';

const s = suite('live');

const dir = mkdtempSync(join(tmpdir(), 'stripex-live-'));
process.env.STRIPEX_BOARDS_DIR = dir;

let WebSocket = null;
let importError = null;
try { ({ WebSocket } = await import('ws')); } catch (e) { importError = e.message; }

const mod = await softImport('../../src/server/index.js', import.meta.url);

let server = null;
let base = '';
if (WebSocket && mod?.app) {
  server = createServer(mod.app);
  if (mod.attachLive) mod.attachLive(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `127.0.0.1:${server.address().port}`;
}

const board = (name) => ({
  schema: 'stripex/1',
  name,
  board: { cols: 12, rows: 8, pattern: 'strip' },
  breaks: [],
  placements: [],
  wires: [],
});

// Connect, and collect messages until `want` says it has seen enough.
function listen(want, { timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const seen = [];
    const ws = new WebSocket(`ws://${base}/api/live`);
    const done = (err) => { try { ws.close(); } catch { /* already gone */ } ; err ? reject(err) : resolve(seen); };
    const timer = setTimeout(() => done(new Error(`timed out with ${JSON.stringify(seen.map((m) => m.type))}`)), timeout);
    ws.on('error', (e) => { clearTimeout(timer); done(e); });
    ws.on('message', (raw) => {
      let m = null;
      try { m = JSON.parse(String(raw)); } catch { return; }
      seen.push(m);
      if (want(seen, ws)) { clearTimeout(timer); done(null); }
    });
    ws.on('open', () => { if (want.onOpen) want.onOpen(ws); });
  });
}

const api = async (path, opts) => {
  const res = await fetch(`http://${base}${path}`, {
    headers: { 'content-type': 'application/json' }, ...opts,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

s.check('THE FEED EXISTS AND GREETS A CLIENT', async () => {
  ok(!importError, `ws is installed: ${importError}`);
  ok(mod?.attachLive, 'the server exposes attachLive');
  const seen = await listen((ms) => ms.some((m) => m.type === 'hello'));
  const hello = seen.find((m) => m.type === 'hello');
  ok(Array.isArray(hello.boards), 'with the board list');
});

s.check('A BOARD FILE WRITTEN BY HAND REACHES EVERY CLIENT', async () => {
  // THE CASE THAT MATTERS. A change made by an endpoint is easy to announce; a
  // change made by me editing the JSON, or by another machine, is the one no
  // endpoint knows about — and it is the one that had Peter reloading into a
  // stale board while telling me three times the wires were not there.
  const want = (ms) => ms.some((m) => m.type === 'board' && m.slug === 'by-hand');
  want.onOpen = () => {
    setTimeout(() => {
      writeFileSync(join(dir, 'by-hand.json'), `${JSON.stringify(board('By Hand'), null, 2)}\n`);
    }, 150);
  };
  const seen = await listen(want);
  const msg = seen.find((m) => m.type === 'board' && m.slug === 'by-hand');
  eq(msg.project.name, 'By Hand', 'the whole board arrives');
  ok(msg.version, 'with its version');
});

s.check('AND A CHANGE THROUGH THE API IS INDISTINGUISHABLE', async () => {
  // Two routes to the same file must arrive the same way, or the quieter one is
  // a hole in the design rather than an oversight.
  const made = await api('/api/boards', {
    method: 'POST', body: JSON.stringify({ name: 'Via Api', cols: 12, rows: 8 }),
  });
  eq(made.status, 201, 'created');
  const want = (ms) => ms.some((m) => m.type === 'board' && m.slug === 'via-api'
    && m.project.placements.length === 1);
  want.onOpen = () => {
    setTimeout(async () => {
      const cur = await api('/api/boards/via-api');
      await api('/api/boards/via-api/ops', {
        method: 'POST',
        body: JSON.stringify({
          version: cur.body.version,
          ops: [{ op: 'addPart', part: 'res-axial', at: { col: 2, row: 2 }, rot: 0, span: 4 }],
        }),
      });
    }, 150);
  };
  const seen = await listen(want);
  const msg = seen.filter((m) => m.type === 'board' && m.slug === 'via-api').pop();
  eq(msg.project.placements[0].ref, 'R1', 'the part is in the pushed board');
});

s.check('creating a board pushes an updated list', async () => {
  const want = (ms) => ms.some((m) => m.type === 'boards'
    && m.boards.some((b) => b.slug === 'brand-new'));
  want.onOpen = () => {
    setTimeout(() => {
      api('/api/boards', { method: 'POST', body: JSON.stringify({ name: 'Brand New' }) });
    }, 150);
  };
  await listen(want);
});

s.check('a client that has gone away does not stop the others', async () => {
  // One dead socket must not take the feed down for everybody else.
  const dead = new WebSocket(`ws://${base}/api/live`);
  await new Promise((r) => dead.on('open', r));
  dead.terminate();
  await new Promise((r) => setTimeout(r, 100));
  const want = (ms) => ms.some((m) => m.type === 'board' && m.slug === 'after-death');
  want.onOpen = () => {
    setTimeout(() => {
      writeFileSync(join(dir, 'after-death.json'),
        `${JSON.stringify(board('After Death'), null, 2)}\n`);
    }, 150);
  };
  const seen = await listen(want);
  ok(seen.length > 0, 'the survivor is still served');
});

s.check('a board removed pushes a list without it', async () => {
  writeFileSync(join(dir, 'doomed.json'), `${JSON.stringify(board('Doomed'), null, 2)}\n`);
  await new Promise((r) => setTimeout(r, 200));
  const want = (ms) => ms.some((m) => m.type === 'boards'
    && !m.boards.some((b) => b.slug === 'doomed'));
  want.onOpen = () => {
    setTimeout(() => api(`/api/boards/doomed`, { method: 'DELETE' }), 150);
  };
  await listen(want);
  ok(true, 'the list catches up');
});

s.check('the file on disk is what was pushed', async () => {
  // The feed must not become a second version of the truth.
  const raw = readFileSync(join(dir, 'by-hand.json'), 'utf8');
  const want = (ms) => ms.some((m) => m.type === 'hello');
  const seen = await listen(want);
  const row = seen[0].boards.find((b) => b.slug === 'by-hand');
  ok(row, 'the board is listed');
  eq(row.name, JSON.parse(raw).name, 'and the list agrees with the file');
});

const okAll = await s.run();
if (server) { if (mod.closeLive) mod.closeLive(); server.close(); }
process.exit(okAll ? 0 : 1);
