# Configuration and usage

Commands below use `tinybuild`; use `npx tinybuild` when it is installed locally in your app.

`options` starts with common settings; add `--search <word>` for a specific feature. `doctor` lists available or missing tools with suggested fixes. `check` lists the build, files and URLs it verified. Add `--json` for the complete structured results used by scripts and agents.

| Command                                                         | Purpose                                              |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `tinybuild`                                                     | Build, serve and watch for edits                     |
| `tinybuild dev --open`                                          | Start development and open the browser               |
| `tinybuild build`                                               | Build once                                           |
| `tinybuild serve`                                               | Serve existing files without building                |
| `tinybuild config`                                              | Edit common settings with a guided configurator      |
| `tinybuild preview`                                             | Inspect the effective configuration without building |
| `tinybuild validate --strict`                                   | Check configuration, including unknown options       |
| `tinybuild options --search worker`                             | Explain matching options                             |
| `tinybuild init --list`                                         | List available starter projects                      |
| `tinybuild init --example webworkers --dir demo`                | Create a project from a starter                      |
| `tinybuild doctor --target android`                             | Check the tools needed for a target                  |
| `tinybuild status --url http://localhost:8080/_tinybuild/ready` | Check a running server's readiness                   |
| `tinybuild mode=python`                                         | Start a supervised Python backend                    |
| `tinybuild help`                                                | List commands and options                            |

Use `--cfgpath custom.mjs` to select a config; CommonJS `.cjs` configs are supported too. Overrides accept `--port 8081`, `--port=8081` or `port=8081`. Lists accept comma-separated values or JSON arrays. Inline config uses JSON. Explicit CLI settings override the config file, which overrides defaults.

The configurator previews changes, preserves imports/comments/custom code, and backs up the file before saving. `--envFile .env.local` explicitly loads environment values before reading the config. The shipped [TypeScript config](../templates/tsconfig.json) explains browser, React, Node and declaration settings.

For agents and scripts, `options`, `preview`, `validate` and `check` support `--json`. `tinybuild check --json` builds without automatic dependency installation and checks configured output files and URLs; `--stage` includes native staging. `tinybuild dev --json` emits lifecycle events with the listening URL. Keep custom config/plugin and child-process logs on stderr when consuming JSON. Add `--agentGuide` during initialization to include project instructions. See the [configuration example](../../examples/config_workflow/README.md) and [agent guide](agents.md).

## Live reload and development tasks

Use `tinybuild dev --debug` to trace grouped files and the quiet-window delay, queued saves during compilation, static-only refreshes, rebuild reasons and service replacements after config edits. It uses the existing `server.debug` setting, so request logs are enabled too. `--json` adds structured `reload` events with an `action`, file list and optional delay/services; readable logs stay on stderr. Tracing does not change the reload schedule.

The server stays running while persistent esbuild contexts rebuild. A configurable quiet window groups saved files; `server.delay` defaults to 150 milliseconds. Saves during a build are queued, and settled output changes trigger one update. The CLI reports the listening URL after startup and successful builds.

Stylesheets update after successful compilation. Other changed outputs refresh the page. Build and config errors remain visible in an overlay until repaired. Added/deleted files, extra watch directories and config edits are supported. Static files are read per request, so new files are available immediately.

Set `server.hotreload` to `true` or a positive number to enable reload. Reload WebSockets share the HTTP/HTTPS listener at `/hotreload`; SSE transport is also available. The browser derives the host and protocol from its page. `reloadscripts: true` enables script replacement; `tinybuild/client/hot` provides state and cleanup hooks for applications using it.

Use `tasks` to own development backends and other services. Tasks support dependencies, readiness checks, watched restarts and shutdown in dependency order. See [task_workspace](../../examples/task_workspace/README.md) and [hot_hooks](../../examples/hot_hooks/README.md).

## Web server and production

The Node server supports async and parameterized routes, HTTPS, response headers, static mounts, SPA navigation, HTTP/WebSocket proxies, ETags, byte ranges, readiness and graceful shutdown. `server.open` opens the browser, `portRetries` allows development port fallback, and optional request logs and deadlines help diagnose server behavior.

```js
server: {
  root: "public",
  routes: {
    "/api/hello/:name": {
      onrequest: async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ hello: req.params.name }));
        return true;
      },
    },
    "/404": { template: "<h1>Not found</h1>" },
  },
}
```

Set `server.spa` to your HTML entry for extensionless deep links. `server.proxy` forwards API requests and optional WebSocket upgrades to trusted backends. Hidden/private files and escaping paths are denied; explicit file routes are trusted configuration.

For production:

```js
export default {
  production: true,
  bundler: {
    entryPoints: ["index.js"],
    outfile: "dist/index",
    bundleHTML: true,
    minify: true,
  },
  server: {
    root: "dist",
    startpage: "index.html",
    host: "127.0.0.1",
    port: 8080,
  },
};
```

Production disables reload and automatic installation, and requires cached remote imports. Set `root` or `staticRoots` for your deployment layout. Build with `tinybuild build --production`, then serve with `tinybuild serve --production`.

`bundleGzip: true` saves maximum-compression `.gz` copies of scripts, styles, workers and portable HTML. The server serves fresh, smaller gzip copies at ordinary URLs when the browser accepts them. Originals remain available for local/native use and other clients. `server.precompressed: false` disables this selection. API/proxy responses keep their own behavior.

Build-generated PWA workers and manifests support offline distribution. `server.pwa` is relative to the public root: with `root: "public"`, use `pwa: "service-worker.js"` to serve `/service-worker.js`. Absolute filenames are also supported. The optional Python backend provides WebSocket and SSE examples. See the [server guide](server.md), [server_workflow](../../examples/server_workflow/README.md), [gzip_target](../../examples/gzip_target/README.md), [pwa](../../examples/pwa/README.md) and [Python guide](python.md).

## Desktop and mobile apps

Tinybuild gathers HTML, chunks, styles, workers and explicit assets into a native web distribution. Existing custom shells are preserved. Stage mode prepares files without installing an SDK:

```js
{
  bundler: { entryPoints: ["index.js"], outdir: "dist" },
  server: false,
  assets: ["assets"],
  electron: { action: "stage" },
  tauri: { action: "stage" },
  mobile: { android: "stage", ios: "stage" },
}
```

**Electron:** `tinybuild desktop=electron --devtools --inspect=9229` launches against the live server. Main/preload watching can relaunch the shell while frontend saves use ordinary hot reload. Configure window settings, runtime arguments, packaged apps or Forge installers. See [desktop_debug](../../examples/desktop_debug/README.md).

**Tauri:** `tinybuild desktop=tauri` starts a Tauri 2 development app against the server URL. Configure Rust features, targets, debug builds, binary-only distributions and installer bundles. Platform prerequisites are described in the [testing guide](platform-testing.md).

**Sidecars:** bundle an app-owned backend with the desktop distribution. [electron_sidecar](../../examples/electron_sidecar/README.md) uses a separate Node utility process supplied by Electron; [tauri_sidecar](../../examples/tauri_sidecar/README.md) includes a standalone executable. Both demonstrate readiness, validated private IPC, backend preservation during frontend reloads and process cleanup when the app closes.

**Mobile:** `tinybuild mobile=android --device <id>` builds, installs and launches a Capacitor 8 app with live web reload. Android supports USB forwarding, emulator and LAN connections; `--lan --qr` helps open the dev URL on a device. iOS uses a prepared macOS/Xcode host. See [mobile_debug](../../examples/mobile_debug/README.md).

Shared `native` settings and profiles cover app identity, icons, permissions, plugins, capability presets and release variants. Settings are written as overlays in `.tinybuild`; a custom Capacitor config must load or merge its generated overlay to apply those settings. Signing/verification hooks receive artifact directories. SDK compilation, device provisioning and credentials belong to the selected platform. See [native_profiles](../../examples/native_profiles/README.md), [native_capabilities](../../examples/native_capabilities/README.md) and the [enhancement guide](enhancements.md).

Named SSH remotes can launch an existing checkout and forward local debug/server ports: `tinybuild --remote mac --dryRun` previews the plan. Optional lifecycle helpers exercise permission changes and reconnect behavior on prepared devices; macOS helpers handle signature, ticket and notarization checks. See [native_lifecycle](../../examples/native_lifecycle/README.md).

## Troubleshooting reports

`tinybuild doctor --report --json` prints runtime versions, target-specific prerequisite checks, selected resolved build/server settings, task names and native target plans. Add `--target android` or another doctor target to check its tools. The command does not build or install anything; it loads the JavaScript config as preview does. Custom config logging remains application-owned.

Environment values, headers, callbacks, command arguments, build definitions and custom metadata are omitted. Project/home prefixes and URL credentials/query values are redacted. Project filenames, hosts and task names remain useful context; review them before sharing. A config load failure produces a failed report without its raw exception/source. Run `tinybuild check --json` separately for current build, file and URL errors. Reports keep no persistent history.

## Build measurements

`--stats` reports build time and output sizes. Optional `budgets` set size limits, and `diagnostics` can measure compressed output or compare a saved baseline. `tinybuild analyze` provides dependency/output information; `--benchmark` compares fresh and incremental builds. A standalone dependency report is available for exploring output size.

See [build_diagnostics](../../examples/build_diagnostics/README.md), [build_baseline](../../examples/build_baseline/README.md) and the [enhancement guide](enhancements.md).

## Programmatic use

```js
import { bundle, packager } from "tinybuild";

const results = await bundle({
  entryPoints: ["src/index.ts"],
  outdir: "dist",
  bundleESM: true,
  autoInstall: false,
});

const app = await packager(myConfig);
process.once("SIGINT", () => app.close());
process.once("SIGTERM", () => app.close());
```

Importing the package does not start services. Library calls use their supplied config, return results and reject on errors. `packager` returns bundles, its optional server, `rebuild()` and `close()`. `serve` resolves after listening and returns its actual address and `close()`. Public TypeScript types and config autocomplete are included.
