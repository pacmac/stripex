# BUG — an edit made while a save is in flight is never saved

status: in progress
area: storage

## Found

2026-09-17, AFK run, reading `saveToServer` while fixing the save echo. It starts:

```js
if (!state.slug || saving) return;
```

An edit schedules a save 400 ms later. If the previous save has not come back by then, this
returns, and **nothing asks again**. The edit stays on screen, and the save indicator goes to
"✓ saved" when the first save completes. The server never gets it until some later edit
happens to trigger another save.

Probed with every save's response held 2 s: set R1 to the copper side, then 900 ms later set
its value to 10k. Six seconds after that the server has `side: copper` and **no value**, while
the editor shows 10k.

## The change

A save asked for while one is running is **remembered**, not dropped. When the running save
finishes, success or failure, the remembered one is scheduled. Only one is queued: the next
save sends the whole project, so every edit made in the meantime goes with it.

## Files

| file | change |
|---|---|
| `public/app.js` | `saveToServer` queues instead of dropping; `finally` runs the queued save |

## What a green run means

`tests/browser/test_edit_during_save.mjs`: with every save's response held back 2 s, an edit
made during the first save reaches the server.
