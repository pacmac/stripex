# BUG — a slow save's own echo is taken for a foreign change, and wipes undo

status: in progress
area: storage

## Found

2026-09-17, during an AFK run. The side-switch check's *undo puts it back* failed twice under
the full suite's load and passed every time alone. It was not the test.

## The cause

`saveToServer` PUTs the board, and learns its new `version` only when the response arrives.
Meanwhile the server's directory watcher announces the write on the live feed.
`applyFromFeed` ignores a pushed board only when `msg.version === state.version`. So when the
feed's message arrives **before** the PUT's response, which is what load does:

- the editor still holds the **old** version, so its own save looks like someone else's;
- it applies it, sets `state.selection = null`, and calls **`history.reset()`**;
- **the undo stack is gone.** Ctrl+Z does nothing, and the person has no way to tell why.

Held deterministic in a test by delaying the PUT response 1.5 s: undo fails 2 of 2.

## The change

`saveToServer` remembers exactly what it sent, as JSON, while the save is in flight. A pushed
board whose project is **identical** to that is the save's own echo: the editor adopts its
version and changes nothing else, so no reload, no reset, no lost undo.

A pushed board that differs is still applied as before. Someone else's change must still
arrive.

## Files

| file | change |
|---|---|
| `public/app.js` | `saveToServer` remembers what it sent; `applyFromFeed` recognises it |

## What a green run means

`tests/browser/test_save_echo.mjs`: with every save's response held back 1.5 s, an edit is
still undone by Ctrl+Z, and no *changed on the server* banner appears.
