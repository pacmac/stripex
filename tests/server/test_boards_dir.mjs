// The test suite must not write to the boards a person is actually using.
// Governed by docs/specs/boards-on-the-server.md

import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { suite, eq, ok } from '../run.mjs';

const s = suite('boards-dir');

const repoBoards = new URL('../../boards/', import.meta.url).pathname;

s.check('THE BOARDS DIRECTORY CAN BE POINTED SOMEWHERE ELSE', async () => {
  // The browser suite drives the real server. With the directory hardcoded to
  // the repo's boards/, `pnpm run check` opened Peter's live board, autosaved
  // into it and created boards beside it — measured as 35 changed lines in
  // boards/recovered-2026-08-30.json after one run. A suite that edits the
  // user's data is worse than no suite.
  const dir = mkdtempSync(join(tmpdir(), 'stripex-boardsdir-'));
  process.env.STRIPEX_BOARDS_DIR = dir;
  const { app } = await import(`../../src/server/index.js?dir=${encodeURIComponent(dir)}`);
  const srv = createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const before = existsSync(repoBoards) ? readdirSync(repoBoards) : [];
    const res = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Somewhere Else' }),
    });
    eq(res.status, 201, 'the board was created');
    ok(readdirSync(dir).includes('somewhere-else.json'), 'in the temporary directory');
    const after = existsSync(repoBoards) ? readdirSync(repoBoards) : [];
    eq(after, before, 'and the repo boards directory is untouched');
  } finally {
    srv.close();
    delete process.env.STRIPEX_BOARDS_DIR;
  }
});

s.check('and it defaults to the repo boards directory when unset', async () => {
  // The default is what the running server uses, and it must not change.
  delete process.env.STRIPEX_BOARDS_DIR;
  const { boardsDirFor } = await import('../../src/server/boards.js');
  ok(typeof boardsDirFor === 'function', 'the resolution is a function, not a constant');
  ok(boardsDirFor('/repo').endsWith('/repo/boards'), `got ${boardsDirFor('/repo')}`);
  process.env.STRIPEX_BOARDS_DIR = '/somewhere/else';
  eq(boardsDirFor('/repo'), '/somewhere/else', 'the environment wins when set');
  delete process.env.STRIPEX_BOARDS_DIR;
});

process.exit((await s.run()) ? 0 : 1);
