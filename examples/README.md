# Examples

From the repository root:

```sh
npm ci
cd examples/default
npm start
```

Follow the printed URL; Ctrl+C stops development. Choose another folder below for a different use case. `npm run build` builds once. Each README shows what you should see and which file to change.

Every demo keeps the **complete commented tinybuild.config.js**. Its active settings run that example; edit those settings directly.

Prefer a separate project? `npx tinybuild init --list` lists shipped starters. Use `npx tinybuild init --example webworkers --dir my-app`, then install and run inside that folder.

## Pages and libraries

| Example                            | Try it for                                              |
| ---------------------------------- | ------------------------------------------------------- |
| [default](default/README.md)       | JavaScript, CSS imports and live reload                 |
| [default_ts](default_ts/README.md) | TypeScript, source maps, type checking and declarations |
| [library](library/README.md)       | ESM, CommonJS and declaration output                    |
| [multi_page](multi_page/README.md) | Multiple entries, module scripts and routes             |
| [spa](spa/README.md)               | Client routing and extensionless HTML fallback          |

## Workers and portable apps

| Example                                            | Try it for                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| [webworkers](webworkers/README.md)                 | Blob worker imports and cleanup                                    |
| [worker_types](worker_types/README.md)             | Typed .Worker imports, companion declarations and worker factories |
| [worker_files](worker_files/README.md)             | Emitted module workers and shared dependencies                     |
| [node_worker](node_worker/README.md)               | Node worker_threads and emitted worker paths                       |
| [nested_workers](nested_workers/README.md)         | Nested module workers, runtime assets and portable HTML            |
| [worker_pool](worker_pool/README.md)               | Queued RPC, transfers, timeouts and cancellation                   |
| [sharedarraybuffers](sharedarraybuffers/README.md) | Cross-origin isolation and shared/transferred memory               |
| [html_bundle](html_bundle/README.md)               | Portable HTML containing workers, styles and assets                |
| [hot_hooks](hot_hooks/README.md)                   | State and cleanup hooks for script replacement                     |

## Servers and deployment

| Example                                                        | Try it for                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [frontend_backend](frontend_backend/README.md)                 | Frontend with an asynchronous parameterized Node API                        |
| [frontend_backend/backend](frontend_backend/backend/README.md) | Independent TypeScript Node backend                                         |
| [server_only](server_only/README.md)                           | Static pages and asynchronous APIs without bundling                         |
| [server_workflow](server_workflow/README.md)                   | Environment files, browser opening, ports, readiness and production serving |
| [api_proxy](api_proxy/README.md)                               | Same-origin API forwarding to a separate backend                            |
| [proxy_ws_sse](proxy_ws_sse/README.md)                         | WebSocket forwarding and SSE reload                                         |
| [production](production/README.md)                             | Frozen builds and an explicit public root                                   |
| [gzip_target](gzip_target/README.md)                           | Gzip output, browser negotiation and uncompressed fallback                  |
| [pwa](pwa/README.md)                                           | Generated service worker and offline navigation                             |
| [python_backend](python_backend/README.md)                     | WebSocket/SSE clients with a Quart backend                                  |
| [task_workspace](task_workspace/README.md)                     | Owned backend tasks, readiness and coordinated restarts                     |

## Build tools and automation

| Example                                          | Try it for                                                   |
| ------------------------------------------------ | ------------------------------------------------------------ |
| [custom_plugin](custom_plugin/README.md)         | An ordinary esbuild plugin providing a virtual module        |
| [remote_imports](remote_imports/README.md)       | HTTP imports and downloaded-module caching                   |
| [asset_pipeline](asset_pipeline/README.md)       | Lazy chunks, CSS and imported SVG assets                     |
| [asset_copy](asset_copy/README.md)               | Watched asset copying and stale-output cleanup               |
| [config_workflow](config_workflow/README.md)     | Guided editing, backups, scripted settings and previews      |
| [build_diagnostics](build_diagnostics/README.md) | Size limits, dependency reports and build benchmarks         |
| [build_baseline](build_baseline/README.md)       | Compressed sizes, saved baselines and dependency exploration |

## Desktop and mobile

| Example                                              | Try it for                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| [native_shells](native_shells/README.md)             | One web distribution staged for Electron, Tauri and Capacitor           |
| [desktop_debug](desktop_debug/README.md)             | Desktop launch/debug shortcuts, window options and release profiles     |
| [electron_sidecar](electron_sidecar/README.md)       | Packaged Node backend, private IPC, live reload and owned shutdown      |
| [tauri_sidecar](tauri_sidecar/README.md)             | Bundled executable, target-aware builds and Rust-owned backend requests |
| [native_profiles](native_profiles/README.md)         | Shared identity, permissions, plugins and build profiles                |
| [native_capabilities](native_capabilities/README.md) | Camera, file and notification presets with browser fallbacks            |
| [native_lifecycle](native_lifecycle/README.md)       | App lifecycle, device checks, release verification and SSH presets      |
| [mobile_app](mobile_app/README.md)                   | Capacitor staging without an installed SDK                              |
| [mobile_debug](mobile_debug/README.md)               | Install/launch shortcuts, USB/emulator/LAN reload and saved app state   |

## Running backends and native apps

For `remote_imports`, start `node remote-server.js` separately before `npm start`. For `api_proxy`, start `node backend.js` first. The automated example checks supply their own backends on free ports.

`library` and `node_worker` build without a web server. Run `node dist/index.js` in `node_worker` to use its result. Build `html_bundle`, then open `dist/index.html` from disk to use its embedded worker.

For `python_backend`, install `tinybuild/python/requirements.txt`, then use `node ../../tinybuild/bin/global.js mode=python` from that example. Its Python server also serves the page at `http://127.0.0.1:7000`.

Native demos stage by default and do not need an SDK for their ordinary builds. In `desktop_debug`, use `npm run electron:dev` or `npm run tauri:dev` to launch the chosen desktop runtime. In either sidecar example, use `npm run native:dev`; its README explains packaging the backend with the app. Mobile launch scripts require the selected platform's tools, and iOS requires macOS/Xcode.

## Checking examples

`npm run test:examples` discovers every example configuration, builds them in temporary directories, checks browser HTML/assets and verifies native staging with dry-run commands. `npm run test:browser` opens every browser demo and exercises interactive behavior. Native UI, signing and device checks are separate opt-in commands described in the [testing guide](../tinybuild/docs/platform-testing.md).
