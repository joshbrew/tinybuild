# Node server

Start development with live reload:

```sh
tinybuild dev --open
```

For production, build once and then serve the output:

```sh
tinybuild build --production
tinybuild serve --production
```

Check a running server from another terminal:

```sh
tinybuild status --url http://localhost:8080/_tinybuild/ready
```

Development builds and watches while the HTTP listener remains available. Build finishes once. Serve reads existing files without bundling, watching or launching inherited native targets. Explicit build/serve commands override the opposite mode stored in a config. `tinybuild config` offers production and static-server recipes. [server_workflow](../../examples/server_workflow/README.md) is a runnable example.

## Starting without friction

`server.port: 0` chooses a free port. `server.portRetries: 5` tries up to five following ports when a development port is occupied. The printed URL uses the actual port. Production requires its exact port and reports a useful error if another process owns it. Wildcard listeners print a usable localhost URL; `--lan --qr` also provides device addresses.

`--open` opens that URL once. `--open=/settings` opens a particular page. The config form is `server.open`; only the CLI opens the browser. An unavailable desktop opener reports a warning while the server keeps running.

`--envFile .env.local` loads an explicit file before evaluating tinybuild.config.js. A JSON list loads several files: `--envFile '[".env",".env.local"]'`. Existing shell values win; later files override earlier files for the remaining keys. Missing files fail before environment changes are applied. Values are not printed. Keep secrets out of browser define values and public directories. The parser uses [Node's environment-file support](https://nodejs.org/api/environment_variables.html).

For hosts supplying a port, use `port: Number(process.env.PORT || 8080)` in the config. Set host to `0.0.0.0` when the hosting environment must reach the process through its network interface.

## Files, routes and caching

Development defaults to the working directory; production to dist. Use root/staticRoots for public files. Portable HTML uses this same root for its start page. Files are read per request, so additions do not require a restart. Hidden/private files and escaping symlinks are denied; explicit file routes are trusted configuration.

HEAD requests return headers without downloading file content. Development HTML reports its full size, including the reload client, without reading the page body for HEAD. GET requests always use the current page on disk.

Static responses support HEAD, ETags, last-modified checks, ranges and fresh gzip sidecars. Production revalidates files by default, keeping fixed filenames safe across releases. Development uses no-store. Optional production-only cacheControl rules select a URL prefix, file extension or fallback:

```js
cacheControl: {
  ".html": "no-cache",
  "/assets/": "public, max-age=31536000, immutable",
  "*": "public, max-age=0, must-revalidate",
}
```

The longest matching prefix wins over an extension; explicit headers win over these defaults. Immutable caching means you must change the URL when content changes. API/proxy responses keep application/backend cache rules. Gzip and original representations have distinct validators.

Routes accept files, templates, redirects and async callbacks. Return true after handling a response. Parameters are decoded into req.params. Errors receive safe 500 responses; malformed encodings receive 400; missing pages remain 404.

## Readiness, logs and shutdown

Watching starts before the first build, so an edit made during startup is not lost. HTML and plain stylesheet edits stay in the same settled update as source edits. A static-file save cannot clear a failed-build overlay or restore readiness; the source must build successfully first. Turning hotreload off in a running browser workflow pauses source saves while keeping the config file watched, so it can be enabled again. Native liveReload keeps reloading enabled for its development server.

PWA filenames are relative to the public root. `pwa: "service-worker.js"` generates `/service-worker.js` under the served folder, including the default production `dist` folder, and cache URLs use that same root. Explicit absolute filenames remain supported. The standalone generatePWA helper retains its explicit cwd/root/filename arguments.

`/_tinybuild/ready` accepts GET/HEAD and bypasses static caching/redirects. It returns `{ready:true}` with 200 or `{ready:false}` with 503. `server.isReady` can asynchronously check dependencies; a thrown error reports unavailable without exposing details. Failed frontend builds turn readiness off until a settled successful build. Existing output remains available while fixing code.

`tinybuild status` checks the configured address; `--url` selects an actual dynamic/fallback/tunnel/deployment URL. Explicit URLs work independently of the local config. The command reports status/duration, avoids downloading application bodies and exits nonzero when unhealthy. Programmatic probeServer returns information without changing the caller's exit code.

`debug: true` prints one JSON record per HTTP response: method, path, status, durationMs. Query strings and headers are omitted. Use onRequest to send records to your own logger. Disconnected responses report 499; logging failures do not take the server down.

`requestTimeout` limits how long clients take to send request data. `responseTimeout` limits inactivity while responding: stuck handlers get 504; active streams continue while sending data. Both default to 30000 ms. Set responseTimeout to 0 for intentionally idle long-lived requests, or choose a larger value. [Node's HTTP documentation](https://nodejs.org/api/http.html) explains request/socket timeouts.

serve() resolves after listening and returns SERVER, SOCKETS, actual port/url, setReady(), setStartpage() and close(). Library startup installs no process signal handlers. close() stops accepting new connections first, marks readiness unavailable, closes reload/relay/proxy sockets and drains HTTP up to shutdownTimeout. The CLI handles SIGINT/SIGTERM. Use your host's normal service supervisor for automatic restart after a machine/process failure; tinybuild does not add another production process manager.

packager.close() attempts every owned cleanup even if native cleanup fails, then reports collected errors. One-shot setup tasks are cancelled when their workspace closes, including during a restart; shutdown does not wait for their ordinary execution timeout.

HTTPS keypath/certpath resolve relative to the configured project directory. Reload shares that TLS listener. An existing reverse proxy can terminate HTTPS and forward to a loopback Node listener. Forward /hotreload upgrades during development; choose SSE reload when upgrades are unavailable.
