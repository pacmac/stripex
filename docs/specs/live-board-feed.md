# SPEC — the file is the board, and the screen follows it

status: implemented, entries CLOSED
area: storage
source_hash:
  src/server/live.js:   0132c9ffeeaff4b79e05eec88ec4fd0e97aac81b4a6aab9c04078406356acad0
  src/server/index.js:  4057fa1fec61f8cb85e3ffba3a303f7fb68ec02ba8f105ed56de0c963ea60e82
  src/server/main.js:   610487e001932c7d8383108ef5fc7b96d8dcf6bf37aadedb74ba44bad19fa108
  public/app.js:        4aa70e8f5cd3db4b68e81252072bf94ba98db0b5e301e2fe20044262667465dc
  package.json:         17e78ebfe2067869778aa368853ad3f9a8d6db668805bb36e05ae64128249772

## Two faults found by shipping it, both about STARTING

Neither was visible to any suite, because every suite imports `app` and drives it in-process —
which evaluates the module fully and never runs the start path.

1. **A temporal dead zone killed the server.** `attachLive` was called from the listen block,
   above the `let live = null` it references. 48 suites passed and the server would not boot.
   `tests/render/test_boot.mjs` was written for exactly this class of fault in `app.js`;
   nothing covered the server. `tests/server/test_server_starts.mjs` now does, by spawning it.
2. **`if (process.argv[1] === fileURLToPath(import.meta.url))` does not survive pm2.** In fork
   mode pm2 runs its own container script and requires the app, so `argv[1]` is pm2's wrapper,
   the guard was false, and the process reported **online** while listening on nothing and
   logging nothing at all. A guess about how a file was reached is a poor thing to hang a
   server's existence on: `src/server/main.js` exists to start, and cannot be ambiguous about
   it.

## Run as a service

Peter, 2026-08-30: *"you should run this as a pm2 service with ecosystem file"*. It was being
started by hand, which is how it came to be down today — nothing restarted it.
`ecosystem.config.cjs`, fork mode with one instance because the feed keeps its clients in
process memory and two workers would each know half of them, and `watch: false` because the
server watches `boards/` itself.

Peter, 2026-08-30: *"I think that the entire board should be a ws feed, so that changes that
are made to the config file are updated immediately in the dashboard. that system of receovered
files etc hacks is very convoluted and confusing."*

## What is wrong, counted

Today the file and the screen are two copies with no channel between them, and everything
built to reconcile them has failed at least once:

| | |
|---|---|
| `a-reload-with-no-edits-overwrites-the-server` | every load pushed the browser's copy up, destroying anybody else's edit |
| `opening-a-board-discards-newer-local-work` | opening installed the server's copy over unsaved work |
| `a-clean-browser-refuses-to-open-a-board` | a blank board counted as a draft, so a clean browser drew an empty grid over a file full of work |
| `the-editor-asks-about-a-draft-with-nothing-unsaved-in-it` | "your copy differs" on every load, for ever, because differing bytes is not the same question as unsaved work |

Four bugs, one cause: **nothing tells the browser the file changed.** Every one of those was
an attempt to guess it after the fact. Peter lost work to the first two and was stuck in a
loop by the fourth, telling me three times that wires I had written were not on his screen.

He is right that it is convoluted. The convolution is the workaround.

## The feed

The server already knows when it writes a board. It can also watch for writes it did not make
— mine by hand, another session's, an editor on another machine.

```
GET /api/live                     a WebSocket
  <- {type:'hello', boards:[…]}
  <- {type:'board', slug, version, project}      whenever a file changes
  <- {type:'boards', boards:[…]}                 whenever the list changes
```

**The whole project on every change, not a diff.** A board is about 3 KB; a diff protocol is a
second description of the model with nothing checking it against the first, and this project
has been bitten by exactly that shape twice. Send the board.

**Watch the directory, not the endpoint.** A change made by `POST /ops` and a change made by
me editing the JSON in an editor must arrive identically, or the second one is a hole in the
design rather than an oversight.

## What this deletes

Once the browser is told, most of the reconciliation stops being needed:

- **`stripex.dirty`, the draft comparison, and the "NOT the one on the server" banner** all go.
  They exist to guess what the feed now states.
- The localStorage copy stays, and its job narrows to what it is actually good for: **drawing
  the board while the server is unreachable.** It is a cache, not a second source of truth.

## The one case the feed does not settle

A person editing while the file changes underneath. The feed cannot decide that and neither
can a heuristic: only the person knows whether their half-drawn wire matters more than what
arrived.

So: **an arriving board is applied when the editor is idle, and offered when it is not.** Idle
means no uncommitted interaction — no half-drawn wire, no armed move. The offer is a banner
with a **button**, not an instruction to go and find a card, which is what left Peter clicking
through a panel to see his own board.

## Files

| file | change |
|---|---|
| `src/server/live.js` | new: the watcher and the socket registry |
| `src/server/index.js` | mount the feed |
| `public/app.js` | follow the feed; delete the draft reconciliation |
| `package.json` | `ws` |

## Explicitly NOT changed

- The REST API. The feed is how you learn; PUT and ops are how you write.
- The version guard on writes, which is what stops two writers clobbering.
- `boards/` and the file format.

## What a green run means

`tests/server/test_live.mjs` and `tests/browser/test_live_board.mjs` report `N/N checks
passed`:

- a client connects and is greeted with the board list;
- **writing a board file by hand pushes it to every connected client**, with its new version —
  the case that matters, because it is the one no endpoint knows about;
- a change through `POST /ops` pushes the same way, so the two routes are indistinguishable;
- creating and deleting a board pushes an updated list;
- a client that has gone away does not stop the others being served;
- and in a real browser: **a board edited on disk appears in an open editor with no reload and
  no clicking**, which is the whole of what Peter asked for.
