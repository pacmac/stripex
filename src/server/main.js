// The entry point. Its whole job is to start the server.
//
// It exists because `if (process.argv[1] === fileURLToPath(import.meta.url))`
// does not survive a process manager. pm2 in fork mode runs its own container
// script and requires the app, so argv[1] is pm2's wrapper and the guard is
// false: the process came up, reported "online", logged nothing, and listened on
// nothing. A guess about how a file was reached is a poor thing to hang a
// server's existence on.
//
// A file whose only purpose is to start cannot be ambiguous about it.

import { start } from './index.js';

start();
