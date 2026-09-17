# BUG — an editor with a board open does not follow a rename

status: in progress
area: storage

Registered as `renaming-a-board-someone-has-open-resurrects-it-under-the-old-name`: Peter had
555-blinker open, renamed it to 555-blinker-v1, and 16 seconds later a second board called
555 blinker appeared.

## Reproduced 2026-09-17, and it is not what was registered

On a scratch board, with an editor open on it: rename over the API, then place a part in
that editor.

- **No board reappears under the old name.** The version guard added since makes a save to
  a slug that no longer exists refuse (`no-such-board`) instead of creating it.
- **The editor stays on the old slug.** Its board label still says the old name, and every
  edit from then on fails: *"NOT SAVED to the server — there is no board called
  rename-probe."* The work stays on screen and never reaches the server.

The harm moved from a duplicate board to lost saves. The cause is the same: nothing tells
an open editor that its board was renamed. The live feed pushes a new board list, and the
editor cannot tell a rename from a delete plus a create.

## The change

**The server announces a rename.** `POST /api/boards/:slug/rename` broadcasts
`{ type: "renamed", from, to, name, version }` on the live feed once the file has moved.

**An editor on `from` follows it:** it adopts `to` as its slug, the new name, and the new
version, and remembers `to` as the open board. Then, if a save had failed because the board
"did not exist", it saves again. The name comes across with the version, so the next save
does not write the old name back.

## Files

| file | change |
|---|---|
| `src/server/live.js` | `renamed(from, to, name, version)` broadcasts it |
| `src/server/index.js` | the rename route calls it |
| `public/app.js` | an editor on `from` follows the rename |

## What a green run means

`tests/browser/test_rename_while_open.mjs`: an editor with a board open, renamed over the
API, shows the new name and remembers the new slug; an edit made afterwards is saved to
the new board with no *NOT SAVED* banner; and no board exists under the old slug.
