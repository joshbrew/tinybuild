# Native macros and development helpers

See native_profiles, nested_workers, hot_hooks, task_workspace and build_diagnostics in the example catalog. The helpers are also available independently from the package.

## Native profiles

```js
import { nativeApp } from "tinybuild";
export default {
  ...nativeApp({
    id: "com.example.app",
    name: "Example",
    version: "1.2.0",
    buildNumber: 12,
    icons: {
      electron: "resources/icon.png",
      tauri: ["resources/icon.ico"],
      mobile: "resources",
    },
    targets: {
      electron: { action: "stage" },
      tauri: { action: "stage" },
      mobile: { android: "stage", ios: "stage" },
    },
    permissions: {
      android: ["android.permission.CAMERA"],
      ios: { NSCameraUsageDescription: "Attach a photo." },
      tauri: ["core:default"],
    },
    plugins: [
      { target: "mobile", name: "@capacitor/camera", version: "^8.0.0" },
    ],
    profiles: {
      debug: {
        devUrl: true,
        targets: {
          electron: { action: "open" },
          mobile: { android: { action: "run", target: "emulator-5554" } },
        },
      },
      release: {
        targets: {
          electron: { action: "package" },
          tauri: { action: "build" },
          mobile: { android: "build", ios: false },
        },
        signing: {
          requiredEnv: ["SIGNING_IDENTITY"],
          command: ["node", "scripts/sign-release.js"],
        },
      },
    },
  }),
  bundler: { entryPoints: ["index.js"], outfile: "dist/index" },
  server: { port: 8080 },
};
```

Use tinybuild build for SDK-free staging, tinybuild --profile debug --lan --qr for device development, and tinybuild build --profile release for explicit native packaging. Profiles inherit shared settings; target objects merge, arrays replace, and plugin lists append.

Electron receives shared name/version/bundle ID and a copied runtime icon. Tauri receives a generated config overlay and capability file. Capacitor receives identity, webDir and development URL. Existing Android Gradle version/name fields and matching iOS plist fields receive version/build-number updates; iOS marketing versions use the numeric semantic-version prefix. Changing identifiers in an existing Android/iOS source project still requires its normal platform migration.

Android permissions and missing iOS usage descriptions are added without replacing existing descriptions. Tauri permissions use a generated capability file. Plugins install only for active targets; staging invokes no package manager or SDK. Tauri uses its official add command, skips installed Rust/JS plugins, and refuses missing plugins in frozen mode.

Mobile actions: stage, add, sync, open, run and build; true remains an alias for run. Device target applies to run, and Android flavor to run/build. icons.mobile names a resource directory with the source logo/icon files expected by the [Capacitor asset generator](https://github.com/ionic-team/capacitor-assets), which runs after platform creation.

Overlays live in .tinybuild and do not serialize the command environment. New Capacitor configs load the generated file. Existing configs remain intact and stage results expose config.manualConfig. Merge the overlay before invoking SDK actions:

```ts
import fs from "node:fs";
import path from "node:path";
const generated = JSON.parse(
  fs.readFileSync(path.resolve(".tinybuild/native-capacitor.json"), "utf8"),
);
export default { ...yourExistingConfig, ...generated };
```

SDK actions fail before package installation if integration is missing. Native-specific capacitor and tauri objects can override generated settings. Profile changes regenerate overlays, so release configuration does not retain a debug URL.

Signing remains application-owned. requiredEnv checks names before release commands; command runs after successful packaging with credentials in its environment. The hook must actually sign/notarize artifacts. SDK builds, provisioning and certificate verification require platform tools. See [Tauri distribution](https://v2.tauri.app/distribute/) and [Electron signing](https://www.electronjs.org/docs/latest/tutorial/code-signing).

Electron action:'make' adds an opt-in Electron Forge distribution step. Configure makers such as @electron-forge/maker-zip, maker-squirrel, maker-dmg or maker-deb; the default is a ZIP distribution. Installers require their platform tools. Maker objects accept name, optional version, platforms and config; third-party makers require a version. The forge option supplies JSON-serializable Forge settings. An existing custom Forge config is preserved unless makers/forge overrides are explicitly supplied. Shell dependencies are installed inside the Electron directory; frozen mode requires them there already. Results expose invocation working directories along with command arguments. See the [Forge makers reference](https://www.electronforge.io/config/makers).

## Devices and readiness

tinybuild devices lists Android devices, offline/unauthorized status, configured virtual devices, and available iOS simulators on macOS. Missing tools appear in the inventory's errors. Discovery installs or starts nothing.

--lan binds all IPv4 interfaces and prints LAN URLs. --qr also enables LAN serving and writes .tinybuild/dev-qr.svg. Devices must be able to reach the address through your network/firewall. native.devHost selects an address; native.devUrl:true uses the actual listening server/port. Links appear before blocking native commands open the application.

Library helpers: discoverDevices(), developmentURLs(url, {host}), developmentQR(url, {width, margin}). QR margin is in pixels. packager accepts signal and onReady; the callback runs after server/watchers are ready and before native tools. Cancellation and task shutdown stop owned process trees.

## Portable workers

Workers can import other worker modules. Recursive builds track dependencies, return child outputFiles with write:false, and publish files after parent success. Circular imports report their chain.

```js
// bundler config
workerType: "module",
blobWorkers: false,
bundleHTML: true,
runtimeAssets: { settings: "assets/settings.json" },

// task.worker.js
import settingsURL from "tinybuild:asset/settings";
onmessage = async () => postMessage(await (await fetch(settingsURL)).json());

// index.js
import { createWorker } from "./task.worker.js";
const worker = createWorker({ name: "example" });
worker.onmessage = ({ data }) => { console.log(data); worker.terminate(); };
```

Explicit runtime assets become data URLs in every variant, including nested workers and portable HTML. Computed URLs and remote fetches remain application dependencies. Module/classic presets control browser output and factory options; Node uses emitted .mjs/.cjs extensions.

Default worker URL exports remain supported. createWorker shares a Blob URL and releases it after the last factory-created worker terminates, recreating it for a later factory call. revokeWorkerURL supports direct new Worker(defaultURL) usage; release after the last direct worker terminates. Revoking a URL does not terminate workers. File/Node factories expose a no-op revoker.

## Script reload hooks

```js
import { createHotContext } from "tinybuild/client/hot";
const hot = createHotContext("counter");
let count = hot.data.count || 0;
hot.dispose(async (data) => {
  data.count = count; /* remove listeners/timers */
});
hot.accept(() => console.log("Updated", hot.data));
```

Enable server.reloadscripts:true. Disposers run before replacement; the next execution reads the same data and registers fresh callbacks; accept hooks run after scripts load. Async hooks are awaited, updates serialize, and registration returns an unsubscribe function. hot.invalidate() reloads the page.

Hook/load failures show the overlay; a full reload recovers failed disposal. Lazy chunk/unmatched output changes reload the page to invalidate module caches. Sourcemaps do not trigger reload. These are app-level lifecycle hooks, rather than module HMR.

Classic script contexts automatically belong to the executing script, so replacing one entry leaves other entries' hooks intact. For ESM entries, pass import.meta.url as the second argument: createHotContext('counter', import.meta.url). Without an available script owner, a context applies to the whole app.

## Workspace tasks

```js
tasks: {
  prepare: { command: "node", args: ["prepare.js"], mode: "once" },
  api: { command: "node", args: ["api.js"], dependsOn: ["prepare"], ready: { url: "http://127.0.0.1:9000/ready", timeout: 10000 }, watch: ["api.js"] },
  ui: { command: "node", args: ["ui.js"], dependsOn: ["api"], ready: { stdout: "READY" } },
}
```

Tasks start sequentially in dependency order. Once tasks must exit successfully; services wait for spawn, HTTP readiness or a literal stdout/stderr marker. Output matching uses a bounded recent buffer. HTTP expects status 200 unless ready.status is set. Default timeouts: 60 seconds for once tasks, 10 seconds for service readiness.

Edits restart a task and its dependents, stopping dependents first. Failed startup/restarts clean up partial services and can recover on a later restart. Unexpected service exits are reported and their dependents stop. There is no automatic crash loop. Shutdown reverses dependency order and supports AbortSignal. Commands use argument arrays without a shell; use an executable rather than a Windows .cmd shim. node resolves to the running Node executable.

packager owns development tasks; one-shot builds validate the graph and start none. Config reload recreates it. Ignore generated output appropriately. startTasks(tasks, options) returns status, restart(name), close(); taskOrder validates without launching. onEvent reports lifecycle state, onError runtime failures.

## Build diagnostics

```js
budgets: { totalBytes: 200000, entryBytes: 100000, onExceed: "error" },
stats: true,
```

tinybuild analyze builds once and prints output sizes, dependencies/imports and violations. Each output path is counted once, including portable HTML in addition to its normal distribution. Sizes are raw bytes; entry budgets apply to individual outputs, rather than transitive chunk totals.

Violations warn by default; onExceed:'error' fails builds and shows the development error overlay. app.report, app.stats.reason (initial/manual/files/config), and onBuild expose diagnostics programmatically.

tinybuild --benchmark=5 measures fresh-context and warm-context builds with min/median/mean samples. Warmup defaults to one rebuild. OS/package caches remain warm and sources remain unchanged. benchmarkBuild(config, {iterations, warmup}) provides the same report.

## Guided config and read-only plans

Run `tinybuild config` for a guided starting point (current, browser, portable HTML, library, Node, Electron, Tauri, Android or iOS). It previews the plan, asks before saving, backs up the original, and adds one small managed section. Imports, plugins, callbacks and comments remain intact. Repeating the command updates that section. Values in it override earlier values in the file; advanced users can move them into the main object and remove the managed section. Both ESM and CommonJS configs work. Unsupported export styles fail without changing the file.

For automation, `tinybuild config --set '{"server":{"port":8081}}' --dryRun` previews changes; replace dryRun with `--yes` to save. JSON quoting depends on the shell. `configure({edits:{server:{port:8081}},yes:true})` provides the same operation from JavaScript.

`tinybuild preview` lists resolved outputs, plugins, task order, watch roots and conditional native commands. It starts no services, installs nothing and writes no generated files. Config modules execute as ordinary JavaScript. Credential/environment fields are redacted from the plan. `tinybuild validate --strict` turns unknown keys into failures with spelling suggestions; default validation warns to retain compatibility with custom stacks. Put application-specific data in `metadata`.

The [annotated config](../templates/tinybuild.config.js) is the full feature reference. The `config_workflow` example covers guided and scripted usage.

## Mobile debug loop

`tinybuild mobile=android --device emulator-5554` builds, starts the live server, then asks Capacitor to build/install/launch the selected app. Android defaults to USB forwarding of the actual listening port; `--connection emulator` uses the emulator host bridge and `--connection lan` uses a reachable network address. `tinybuild mobile=ios --device <simulator-id>` defaults to a simulator on macOS; physical iOS devices use LAN. `devices` lists available targets. Set `mobile.<platform>.host` for a specific LAN address, plus optional flavor, scheme or configuration. HTTPS requires device trust of the development certificate.

The matching config is `{mobile:{android:{action:'run',liveReload:true,connection:'usb',target:'emulator-5554'}}}`. Mobile live mode requires an active development server. Capacitor's CLI live flags avoid persisting a debug server URL into release config. The server keeps its chosen port during config reloads. Normal source saves rebuild without replacing the server; HTTP reads include new/changed files immediately. A 150 ms quiet window batches saves (`server.delay` overrides it). Intermediate builds with pending saves do not publish extra reloads. Backend task restart requests coalesce and stop owned processes before replacements start. The CLI repeats the live URL after startup/packaging completes and after each successful settled build.

`examples/mobile_debug` stages without SDKs by default and demonstrates counter preservation during script replacement. `smokeMobile` and `scripts/check-mobile.js` optionally install an already-built APK or simulator .app and verify a running process. An explicit target is required; `--dryRun` only prints commands. iOS execution needs macOS; no emulator/VM or container is created. This is an install/launch smoke check, not an app UI or signing verification.

## Native capabilities

`native.presets` accepts `camera`, `files`, and `notifications`. It selects official Capacitor 8 dependencies, camera usage descriptions and the Android notification declaration. Explicit plugin versions and usage descriptions override presets; entries deduplicate. SDK-free staging installs nothing. Runtime permission prompts still belong in the app. Android camera gallery saving, exact notification alarms and shared document access need the additional declarations documented by their plugins. Filesystem use on iOS also requires an app-reviewed privacy manifest/reason; the preset does not choose that assertion.

Secure storage uses `{name:'secureStorage',plugin:{name:'your-provider',version:'...'}}`; choosing a provider is explicit. The optional `tinybuild/client/native` bridge takes native and web adapters with the same contract. Missing capabilities fail clearly; there is no plaintext fallback for secrets. See `examples/native_capabilities` for a browser fallback, native adapter wiring and platform notes. Primary references: [Camera](https://capacitorjs.com/docs/apis/camera), [Filesystem](https://capacitorjs.com/docs/apis/filesystem), [Local notifications](https://capacitorjs.com/docs/apis/local-notifications).

## Copies and cleanup

`copy:[{from:'public',to:'dist/static'}]` copies directory contents; a source file uses an exact target filename. Optional `filter(relativePath)` selects files. Copy dependencies participate in watching, reload, diagnostics, PWA generation and native staging, including copy-only projects with `bundler:false`. Deleted source assets remove only their unchanged owned copies. Output directories are ignored by watchers. Escaping/circular symlinks, duplicate output paths, environment files and private keys fail before writes.

`tinybuild clean --dryRun` lists generated files eligible for removal; `tinybuild clean` removes them. `.tinybuild/outputs.json` records hashes and paths; cleanup preflights containment and preserves changed or unrecorded files. It never recursively deletes output directories, external builds or SDK projects. Baselines remain user-owned. See `examples/asset_copy`.

## Worker jobs

`tinybuild/client/workers` exports `serveWorker`, `createWorkerPool` and `transferResult`. Handler methods receive `(value,{signal})`; the pool queues bounded work, transfers buffers, propagates errors, supports timeout/AbortSignal cancellation and replaces failed workers. Cancelling active work terminates its worker, including synchronous CPU loops; its other global state is therefore reset. Close the pool when disposing the app. Limits default to at most four workers and 100 queued jobs. Pass an explicit worker_threads parentPort to serveWorker in Node. Generic method contracts type inputs/results without code generation. See `examples/worker_pool`, which also builds as portable HTML.

## Compression, baselines and dependency inspection

Set `diagnostics:{compression:true,baseline:'tinybuild.baseline.json',report:'dist/report.html'}` and optional `budgets:{gzipBytes:60000,brotliBytes:50000,growthBytes:1000}`. Compressed budgets sum separately compressed output files; growth compares total raw output bytes with the baseline. `tinybuild baseline` explicitly rebuilds and updates the baseline, skipping growth enforcement and native launches; other budgets still apply. Commit baselines for review. `dist/report.html` is a standalone searchable dependency report; selecting an output shows its contributing sources. No extra browser framework or network service is needed. See `examples/build_baseline`.

## WebSocket proxy and SSE reload

Set `server.proxy['/socket']={target:'http://localhost:7000',stripPrefix:true,ws:true}` for upgrade forwarding. Paths, query strings, binary messages and negotiated subprotocols are preserved; shutdown closes owned upgraded connections. Handshake timeouts use the proxy timeout. `allowedOrigins` applies to upgrade requests and reload streams.

`server.hotreloadTransport:'sse'` selects EventSource at `/hotreload/events`; the default remains WebSocket. Both transports replay active build errors, publish recovery, and share the existing HTTP/HTTPS listener. Slow SSE readers are disconnected with bounded buffering and reconnect normally. Production disables the reload stream. See `examples/proxy_ws_sse`.

## Desktop development and releases

`tinybuild desktop=electron --devtools --inspect=9229` starts a live Electron app, opens renderer DevTools, and enables Node inspection for the main process. `tinybuild desktop=tauri` starts the Rust app against the actual listening server/port. Both shortcuts enable hot reload and select only that native target; the config editor also offers Electron and Tauri recipes. They are development shortcuts: use release profiles with `build` for packaging. Existing build-only Tauri options are cleared when selecting its development shortcut.

The equivalent options are `electron:{action:'open',liveReload:true,devtools:true,inspect:9229,args:['--demo'],window:{width:1100,height:720}}` and `tauri:{action:'dev',liveReload:true}`. With a listening server, Electron open and Tauri dev use its URL automatically; `liveReload:false` selects staged Electron files or Tauri's own static development server. Electron window settings support sizing/limits, title, background color, resizable, maximizable and fullscreen. Advanced BrowserWindow options belong in a custom main script. Fresh shells keep context isolation/sandboxing enabled and Node integration disabled, deny new popup windows, and ignore debug URLs/DevTools when packaged. Custom main/preload source is preserved; integrate these settings explicitly in existing shells. Web saves reload without restarting Electron; main/preload changes require relaunching it. Tauri's own watcher handles Rust changes; `watch:false` disables that watcher.

Tauri accepts `features`, `target`, `debug` and `noBundle` (binary-only) or explicit `bundles`. Generated overlays supply the current dev URL and a development-only CSP that permits the injected reload script and same-server socket. Production CSP remains separate; `native.tauri` retains explicit advanced overrides. Existing `beforeDevCommand` hooks are preserved and should not start another copy of the frontend server already owned by tinybuild. The template uses the listening development port.

Release plans return `artifactDirectories`. Electron make reports its shell `out/make` directory; package reports its chosen release directory. Tauri reports its conventional Cargo debug/release bundle directory (or binary directory with noBundle), honoring `CARGO_TARGET_DIR` and explicit target triples. Custom workspaces may have another layout. Signing hooks receive this array as `TINYBUILD_ARTIFACT_DIRS` JSON. Inherited `TINYBUILD_DEV_URL` is removed from release command environments, and development macro URLs are omitted from release-only overlays.

Config reload validates types and the task graph before replacing resources. Only changed server/task settings recreate those services. Invalid config keeps the current session available; a listener replacement that fails attempts to restore the previous port. Watch roots are refreshed, including newly selected external copy directories. Portable HTML entry path changes update the live start page. The CLI continues reporting URLs while a native command is still running.

See `examples/desktop_debug`. The optional manual native workflow packages Electron ZIPs, compiles Tauri binaries on three OS runners, and exercises Electron's real UI. `npm run test:native -- --tauri --dry-run` checks the Tauri plan locally without an SDK; omit dry-run on a prepared host to compile and verify the executable header. The [platform testing guide](platform-testing.md) covers native UI checks, separate signature verification, Ubuntu/WSL and container development. References: [Tauri CLI](https://v2.tauri.app/reference/cli/), [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [Electron main-process debugging](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process).

Server-controller shutdown also aborts its active native command. Closing from onReady prevents native launch entirely. Reload clients refresh once after reconnecting, so a build message missed during a listener replacement cannot leave old code on screen. The generated Tauri policies include local IPC connectivity and WebAssembly compilation; the relaxed inline-script rule is confined to development. Applications can override their policy explicitly.

For programmatic entry changes, `app.server.setStartpage('pages/dashboard.html')` updates the request handler without replacing its listener. Portable HTML builds use this when their output path changes.

A native development session with an initial frontend build error keeps its server and overlay running. Native staging/launch waits for the first successful settled rebuild; closing the controller cancels that wait. One-shot builds still fail immediately.
