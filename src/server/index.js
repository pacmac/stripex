// The stripex server.
//
// It serves src/ as static ES modules on purpose: the browser imports the SAME
// files node does — the same geometry constants, the same net derivation, the
// same renderer. A serialised copy of the model shipped to the client would be a
// second version of the truth with nothing checking it against the first.

import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { partList, getPart } from '../parts/library.js';
import { deviceList } from '../parts/devices.js';
import { resolvePins } from '../model/rotate.js';
import { validateProject, makeProject } from '../model/board.js';
import { renderBoard, findingsFor, netsFor, runList } from '../render/svg.js';
import * as boards from './boards.js';
import * as ops from '../model/ops.js';
import * as rules from '../model/rules.js';
import { attachLive as makeLive } from './live.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = express();

app.use(express.json({ limit: '4mb' }));
app.use('/src', express.static(path.join(root, 'src')));
app.use(express.static(path.join(root, 'public')));

app.get('/api/parts', (_req, res) => res.json(partList()));

// The named components — XIAO, TMC2209, the JST family. /api/parts has always
// existed; this never did, so a caller had no way to learn that any of them
// exist, let alone which of their pin names are unverified.
app.get('/api/devices', (_req, res) => res.json({ devices: deviceList() }));

app.get('/api/new', (req, res) => {
  const cols = Number(req.query.cols ?? 25);
  const rows = Number(req.query.rows ?? 20);
  res.json(makeProject({ cols, rows, name: String(req.query.name ?? 'untitled') }));
});

// Server-side render, for the exporter and for anything that wants a picture
// without running a browser.
app.post('/api/render', (req, res) => {
  const { project, ...opts } = req.body ?? {};
  const problems = validateProject(project);
  if (problems.length) return res.status(400).json({ problems });
  res.type('image/svg+xml').send(renderBoard(project, opts));
});

app.post('/api/check', (req, res) => {
  const project = req.body?.project;
  const problems = validateProject(project);
  if (problems.length) return res.status(400).json({ problems });
  res.json({
    findings: findingsFor(project),
    nets: netsFor(project).nets,
    runList: runList(project),
  });
});

// ----------------------------------------------------------------- boards
//
// Files on disk, in the repository, so a board can be shared, edited by hand,
// read by Claude, and recovered from git. That last one is not theoretical: a
// board has already been lost in this project.
//
// EVERY WRITE IS GUARDED BY A VERSION. If somebody edits boards/x.json while the
// editor has it open, the editor's next autosave would erase it silently. A
// write presenting a version that is not the one on disk is refused with 409 and
// the current board, and the editor asks rather than choosing.

// Resolved per request, not captured once: the tests point STRIPEX_BOARDS_DIR at
// a temporary directory so a check run cannot touch a board somebody is using.
const boardsDir = () => boards.boardsDirFor(root);

// One place that turns a store error into a status, so a new error code cannot
// quietly become a 500.
const BOARD_STATUS = {
  'bad-slug': 400,
  'bad-name': 400,
  'no-such-board': 404,
  exists: 409,
  stale: 409,
};

function boardError(res, e) {
  const status = BOARD_STATUS[e?.code];
  if (!status) throw e;                       // not ours: let it be a 500 and be logged
  const body = { error: e.message, code: e.code };
  if (e.version) body.version = e.version;
  if (e.project) body.project = e.project;    // a stale write is handed the newer board
  return res.status(status).json(body);
}

app.get('/api/boards', (_req, res) => res.json({ boards: boards.list(boardsDir()) }));

app.post('/api/boards', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const slug = boards.slugFor(name);
  if (!slug) return res.status(400).json({ error: 'that name has nothing usable in it', code: 'bad-name' });
  const project = req.body?.project
    ? { ...req.body.project, name }
    : makeProject({
      cols: Number(req.body?.cols ?? 25),
      rows: Number(req.body?.rows ?? 20),
      name,
    });
  const problems = validateProject(project);
  if (problems.length) return res.status(400).json({ error: problems[0].message, problems });
  try {
    return res.status(201).json({ ...boards.write(boardsDir(), slug, project, null), name, project });
  } catch (e) { return boardError(res, e); }
});

app.get('/api/boards/:slug', (req, res) => {
  try { return res.json(boards.read(boardsDir(), req.params.slug)); }
  catch (e) { return boardError(res, e); }
});

app.put('/api/boards/:slug', (req, res) => {
  const project = req.body?.project;
  // Validated BEFORE it is written. A store that accepts a board the editor
  // cannot open is a store that loses boards.
  const problems = validateProject(project);
  if (problems.length) return res.status(400).json({ error: problems[0].message, problems });
  try {
    return res.json(boards.write(boardsDir(), req.params.slug, project, req.body?.version ?? null));
  } catch (e) { return boardError(res, e); }
});

app.post('/api/boards/:slug/rename', (req, res) => {
  try { return res.json(boards.rename(boardsDir(), req.params.slug, String(req.body?.name ?? ''))); }
  catch (e) { return boardError(res, e); }
});

// A board BUILT over HTTP, rather than clicked.
//
// Applied in order, ALL OR NOTHING: the first refusal aborts the batch and the
// file is untouched, so a half-built board cannot exist. The response says which
// operation stopped it and why, with the rule named.
//
// Same version guard as PUT — and unlike the way I used PUT today, the content
// written is derived from the snapshot the version came from, in one request.
app.post('/api/boards/:slug/ops', (req, res) => {
  let read;
  try { read = boards.read(boardsDir(), req.params.slug); }
  catch (e) { return boardError(res, e); }

  const given = req.body?.version;
  if (given != null && given !== read.version) {
    return res.status(409).json({
      error: 'the board changed since you read it', code: 'stale',
      version: read.version, project: read.project,
    });
  }

  const result = ops.applyOps(read.project, req.body?.ops ?? []);
  if (result.error) {
    return res.status(400).json({
      error: result.error, code: result.code, index: result.index,
    });
  }
  const problems = validateProject(result.project);
  if (problems.length) return res.status(400).json({ error: problems[0].message, problems });

  try {
    const written = boards.write(boardsDir(), req.params.slug, result.project, read.version);
    return res.json({
      ...written,
      refs: result.refs,
      findings: [...findingsFor(result.project), ...rules.checkRules(result.project)],
    });
  } catch (e) { return boardError(res, e); }
});

// WHERE MAY A WIRE LAND? The holes on a pin's strip that nothing occupies.
//
// This is the query I wrote three times in three scratch scripts and got wrong
// twice — once counting the pin's own hole as free, once excluding every column
// any part used anywhere. Without a route, a caller has to guess, and guessing
// is how nine wire ends came to sit on top of pins.
app.get('/api/boards/:slug/free-holes', (req, res) => {
  const { ref, pin } = req.query;
  if (!ref || pin == null) {
    return res.status(400).json({ error: 'ref and pin are both needed', code: 'bad-request' });
  }
  let read;
  try { read = boards.read(boardsDir(), req.params.slug); }
  catch (e) { return boardError(res, e); }

  // A pin that is not there is a 404, NOT an empty list: an empty list reads as
  // "nowhere to put it" and sends a caller looking for a routing problem that
  // does not exist.
  const hasPin = resolvePins(read.project.placements ?? [], getPart)
    .some((p) => p.ref === ref && String(p.pin) === String(pin));
  if (!hasPin) {
    return res.status(404).json({
      error: `${ref} has no pin ${pin} on this board`, code: 'no-such-pin',
    });
  }
  return res.json({ ref, pin, holes: ops.freeHolesOn(read.project, ref, pin) });
});

app.delete('/api/boards/:slug', (req, res) => {
  try { return res.json(boards.remove(boardsDir(), req.params.slug)); }
  catch (e) { return boardError(res, e); }
});

// The live feed. Attached to an http server rather than to the express app,
// because a WebSocket upgrade happens below express — which is also why the
// tests hand it a server rather than importing a socket.
//
// DECLARED ABOVE THE LISTEN BLOCK, and that is not cosmetic: it was below, and
// the listen block calls attachLive, so starting the server as an entry point
// died on a temporal dead zone — "Cannot access 'live' before initialization" —
// while 48 suites passed, because every one of them imports `app` and calls
// things after the module has finished evaluating.
let live = null;

const port = Number(process.env.PORT ?? 3020);

// Bound to 0.0.0.0 explicitly, not left to the default, so it is reachable from
// the other machines on the bench rather than only from localhost.
const host = process.env.HOST ?? '0.0.0.0';

// STARTED BY src/server/main.js, NOT BY GUESSING HOW THIS FILE WAS REACHED.
//
// This used to be wrapped in `if (process.argv[1] === fileURLToPath(...))`, and
// it does not survive a process manager: pm2 in fork mode runs its own container
// script and requires the app, so argv[1] is pm2's wrapper, the guard was false,
// and the process came up reporting "online" while listening on nothing and
// logging nothing at all.
export function start({ port: p = port, host: h = host } = {}) {
  // A real http server rather than app.listen(), because a WebSocket upgrade
  // happens below express and needs the server's own 'upgrade' event.
  const server = createServer(app);
  attachLive(server);
  server.listen(p, h, () => {
    console.log(`stripex listening on ${h}:${p}`);
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4') console.log(`  http://${a.address}:${p}  (${name})`);
      }
    }
  });
  return server;
}

export function attachLive(server) {
  live = makeLive(server, { dirFor: boardsDir });
  return live;
}
export function closeLive() { live?.close(); live = null; }
// Announced by the write endpoints so a change reaches clients immediately; the
// directory watcher is the safety net for writes nothing here made.
export const announce = (slug) => live?.announce(slug);

export { app };
