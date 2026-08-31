# SPEC — the browser keeps no copy of the board

status: implemented, entry CLOSED
area: storage-api
source_hash:
  public/app.js:  e1e0d6ec98a8454dee5d632f773ed412117f0ed7cbb3a5fd4b30a31019c56826

Peter, 2026-08-31, on being shown that the cache was behind all three incidents:
**"STILL BROKEN: the draft cache itself - fix it"**

## What it costs and what it bought

`localStorage` holds `stripex.project` — a full copy of the board — and `stripex.dirty`, and
that copy is treated as authoritative on load. **All three name reversions came from it**, each
one a stale copy written back over the server:

| | |
|---|---|
| first | `openBoard` called `persist()`, so merely looking at a board saved it |
| second | the same, still unfixed, because I had only removed the boot flush |
| third | the `keepDraft` branch adopted the server's fresh version token and wrote old content, defeating the guard |

What it bought: the work done in the **400 ms** between an edit and its save, and the ability
to keep drawing while a server on the same machine is unreachable. Three incidents against
four-tenths of a second.

**A cache that is only ever read at boot is not a cache, it is a second source of truth.**

## The change

`stripex.project` and `stripex.dirty` go. What stays is what genuinely belongs to the browser
and to nothing else:

| key | stays? | why |
|---|---|---|
| `stripex.project` | **gone** | the board is a file on the server |
| `stripex.dirty` | **gone** | there is nothing to be dirty about; a save is 400 ms away |
| `stripex.openBoard` | stays | which board this tab is looking at, which is per-tab and not the server's business |
| `stripex.layers` | stays | a view preference, never part of the document |

The snapshot history stays too. It is a different thing: an archive read only when you press
Restore, never treated as the current board, and it takes its storage as an argument rather
than assuming one.

With no draft there is no `keepDraft` branch, no `isDirty`, and no `recovered <date>` — **that
name existed only to label a rescued draft**, and it is the name that has been haunting his
board all weekend.

## What happens when the server is not there

Today the editor draws from its cache and pretends. **It will say so instead**, plainly, and
not offer a board it cannot save. Editing into a copy that may later overwrite someone else's
work is exactly how this went wrong three times; refusing to pretend is cheaper than being
clever about it.

## Files

| file | change |
|---|---|
| `public/app.js` | the cache, the dirty flag, the keepDraft branch, and the recovered-draft rescue |
| the browser suites | seed a board on the **server** rather than in localStorage |

## Explicitly NOT changed

- Autosave: an edit still reaches the server in 400 ms, version-guarded.
- The live feed, and `applyFromFeed` installing what the server pushes.
- The snapshot history and the Restore button.
- `stripex.openBoard` and `stripex.layers`.

## What a green run means

`tests/browser/test_no_draft_cache.mjs` reports `N/N`:

- after loading a board and editing it, **`localStorage` holds no copy of the board and no
  dirty flag** — the storage is inspected directly, not inferred;
- a reload shows what the **server** has, including a change made behind the editor's back;
- **the board's name survives a reload**, which is the thing that failed three times;
- with the API refused, the editor **says the server is unreachable** rather than drawing a
  board it cannot save;
- `stripex.openBoard` still selects the board and `stripex.layers` still remembers hidden
  layers;
- and an edit still reaches the server, because none of this is worth losing autosave over.

Three suites are **removed** — `test_draft_survives.mjs`, `test_reopen_keeps_work.mjs` and
`test_draft_keeps_the_name.mjs` — because each exists to check the behaviour of a cache that no
longer exists, and a suite that asserts a deleted feature still works is worse than no suite.
The last of those was written an hour before this change, for the fix this one supersedes.

**Their coverage moves rather than vanishing.** "the name survives a reload" is now a check in
`test_no_draft_cache.mjs`, and it is stronger there: it no longer depends on a cache being
correctly ignored, because there is nothing to ignore.

## What the migration found

Five browser suites seeded a board into `localStorage` and read their assertions back out of
it. Seeding is now a `POST /api/boards`, and the reads split two ways:

- where the question was *"what is on the board"*, they read **the drawing** —
  `g[data-kind="part"]` — which is a stronger check than a store, because it asserts what a
  person can see;
- where the question was *"what was saved"*, they ask **the server**, and had to start waiting
  past the 400 ms autosave to do it. Three checks were passing on a 200 ms wait against a
  synchronous cache write.
