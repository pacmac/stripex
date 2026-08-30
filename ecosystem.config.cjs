// pm2 service definition for stripex.
//
// Peter, 2026-08-30: "you should run this as a pm2 service with ecosystem file".
//
// It was being started by hand, which is how it came to be DOWN for a while
// today: a temporal dead zone killed it on boot, nothing restarted it, and the
// editor in his browser had nothing to talk to. pm2 restarts it; the check in
// tests/server/test_server_starts.mjs is what stops it failing to boot in the
// first place.
//
// .cjs and not .js: package.json declares "type": "module", and pm2 reads an
// ecosystem file with require().

module.exports = {
  apps: [
    {
      name: 'stripex',
      // main.js, whose only job is to start. index.js exports the app and no
      // longer tries to work out whether it was run or imported — a guess that
      // pm2 defeated, leaving the process "online" and listening on nothing.
      script: 'src/server/main.js',
      cwd: __dirname,
      // fork, not cluster: the live feed keeps a set of WebSocket clients in
      // process memory, and two workers would each know half of them — so a
      // board change would reach some browsers and not others.
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      // WATCHING IS OFF. The server watches boards/ itself to drive the live
      // feed; letting pm2 watch as well would restart the process on every board
      // save, dropping every connected client to announce a change it was about
      // to announce anyway.
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: 3020,
        // Bound wide on purpose: it is reached from the other machines on the
        // bench, not only from localhost.
        HOST: '0.0.0.0',
      },
      time: true,
    },
  ],
};
