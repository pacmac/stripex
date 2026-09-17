// The live board feed: the file is the board, and everybody watching is told
// when it changes.
//
// Peter, 2026-08-30: "I think that the entire board should be a ws feed, so that
// changes that are made to the config file are updated immediately in the
// dashboard. that system of receovered files etc hacks is very convoluted and
// confusing."
//
// He is right, and the convolution was the workaround. Four bugs in one session
// came from one cause — nothing told the browser the file had changed — so
// everything built to guess it afterwards was wrong at least once:
//
//   a reload overwrote the server with a stale copy
//   opening a board discarded unsaved work
//   a clean browser refused to open a board at all
//   "your copy differs" appeared on every load, for ever
//
// Two of those cost him work. This is the channel that makes the guessing
// unnecessary.

import { WebSocketServer } from 'ws';
import { watch } from 'node:fs';
import path from 'node:path';
import * as boards from './boards.js';

// THE WHOLE BOARD ON EVERY CHANGE, not a diff.
//
// A board is a few kilobytes. A diff protocol would be a second description of
// the model with nothing checking it against the first, which is the shape this
// project has already paid for twice — the ref-prefix table that drifted from
// the library, and the palette highlight that drifted from the armed tool.
const send = (ws, msg) => {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(msg)); } catch { /* a dead socket is not an error */ }
};

export function attachLive(server, { dirFor } = {}) {
  const boardsDir = dirFor ?? (() => process.env.STRIPEX_BOARDS_DIR ?? 'boards');
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();

  // ONE DEAD SOCKET MUST NOT TAKE THE FEED DOWN. A browser that closed its tab
  // is the normal case, not an exception.
  const broadcast = (msg) => {
    for (const ws of [...clients]) {
      if (ws.readyState !== ws.OPEN) { clients.delete(ws); continue; }
      send(ws, msg);
    }
  };

  const listOf = () => {
    try { return boards.list(boardsDir()); } catch { return []; }
  };

  const pushBoard = (slug) => {
    try {
      const { project, version } = boards.read(boardsDir(), slug);
      broadcast({ type: 'board', slug, version, project });
    } catch {
      // Gone, or unreadable. The list tells the truth either way.
      broadcast({ type: 'boards', boards: listOf() });
    }
  };

  // WATCHING THE DIRECTORY, NOT THE ENDPOINTS.
  //
  // A change made by POST /ops and a change made by somebody editing the JSON in
  // an editor must arrive identically, or the second is a hole in the design
  // rather than an oversight. It is the second kind that had Peter reloading
  // into a stale board.
  //
  // Coalesced: a write is often several filesystem events, and pushing a board
  // three times for one save is noise on every client.
  const pending = new Map();
  const bump = (slug) => {
    clearTimeout(pending.get(slug));
    pending.set(slug, setTimeout(() => {
      pending.delete(slug);
      pushBoard(slug);
      broadcast({ type: 'boards', boards: listOf() });
    }, 40));
  };

  let watcher = null;
  const startWatching = () => {
    try {
      boards.ensureDir(boardsDir());
      watcher = watch(boardsDir(), (_event, filename) => {
        if (!filename || !String(filename).endsWith('.json')) return;
        const slug = path.basename(String(filename), '.json');
        if (!boards.isSlug(slug)) return;
        bump(slug);
      });
      watcher.on('error', () => { /* a watch that dies must not take the server with it */ });
    } catch { /* no directory yet; the first write creates it */ }
  };
  startWatching();

  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/api/live')) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
      send(ws, { type: 'hello', boards: listOf() });
    });
  });

  return {
    // Called by the write endpoints so a change is announced immediately rather
    // than waiting for the filesystem to notice. The watcher is the safety net,
    // not the only route.
    announce: (slug) => bump(slug),
    // A RENAME, SAID AS ONE. The list alone cannot tell an open editor that its
    // board moved rather than vanished, so it stayed on the old slug and every
    // save after it failed. See docs/specs/rename-while-open.md.
    renamed: (from, to, name, version) => {
      broadcast({ type: 'renamed', from, to, name, version });
      broadcast({ type: 'boards', boards: listOf() });
    },
    close: () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
      try { watcher?.close(); } catch { /* already closed */ }
      for (const ws of clients) { try { ws.close(); } catch { /* going anyway */ } }
      clients.clear();
      wss.close();
    },
    get size() { return clients.size; },
  };
}
