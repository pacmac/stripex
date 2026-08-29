// The stripex server.
//
// It serves src/ as static ES modules on purpose: the browser imports the SAME
// files node does — the same geometry constants, the same net derivation, the
// same renderer. A serialised copy of the model shipped to the client would be a
// second version of the truth with nothing checking it against the first.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { partList } from '../parts/library.js';
import { validateProject, makeProject } from '../model/board.js';
import { renderBoard, findingsFor, netsFor, runList } from '../render/svg.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = express();

app.use(express.json({ limit: '4mb' }));
app.use('/src', express.static(path.join(root, 'src')));
app.use(express.static(path.join(root, 'public')));

app.get('/api/parts', (_req, res) => res.json(partList()));

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

// Project storage belongs to the storage-api task and is NOT here yet. Saying so
// with a 501 rather than letting the editor discover it as a 404: the editor
// keeps its work in localStorage until this is real, and it says so on screen.
app.all('/api/projects{/*rest}', (_req, res) => res.status(501).json({
  error: 'project storage is not implemented yet — the editor is using localStorage',
}));

const port = Number(process.env.PORT ?? 3020);

// Bound to 0.0.0.0 explicitly, not left to the default, so it is reachable from
// the other machines on the bench rather than only from localhost.
const host = process.env.HOST ?? '0.0.0.0';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, host, () => {
    console.log(`stripex listening on ${host}:${port}`);
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4') console.log(`  http://${a.address}:${port}  (${name})`);
      }
    }
  });
}

export { app };
