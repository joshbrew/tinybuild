# Development and production server

Run `npm run debug` to see which saved files were grouped, whether a refresh used static files or a rebuild, why a config edit replaces services, and when saves wait for an active build. This enables `server.debug`, including its request logs. Add `--json` to the tinybuild command for structured `reload` events on stdout; readable logs go to stderr.

From this folder, `npm start` builds, serves and watches. `npm run open` also opens the actual listening URL. If 8080 is occupied, development tries up to five later ports and prints the chosen address. Use that printed address for checks and other devices.

`npm run build` creates minified production files and gzip copies. Then `npm run serve` serves those existing files without building, watching or launching a native shell. Production requires the exact configured port. `npm run status` checks the configured readiness address; use `node ../../tinybuild/bin/global.js status --url <printed-url>/_tinybuild/ready` after a development fallback or when using a different host/port. Unhealthy checks exit nonzero.

`npm run env` explicitly loads demo.env before reading the config. Shell environment values win; with several envFile entries, later files override earlier files for values absent from the shell. Nothing loads implicitly. This file contains demonstration values, not credentials. Native Node environment-file syntax is supported by the loader, without adding a dependency.

Open the page, click Check readiness, and follow the deep link. The same UI works with development reload or the production server. HTML revalidates before reuse; other files use conservative caching. Long immutable caching belongs only on URLs you change when their contents change.

Readiness reports failed frontend builds and recovers after a successful save. Add server.isReady to check your own database/backend too. The request timeout limits incoming request data; the response timeout ends idle/stuck handlers while active streams keep running. The [server guide](../../tinybuild/docs/server.md) explains deployment, TLS, caching and graceful shutdown.
