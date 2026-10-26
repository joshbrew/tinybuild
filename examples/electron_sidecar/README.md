# Electron with a bundled Node backend

Open a desktop app that runs its calculations in a separate Node process. The process ID (PID) on the page lets you see when the backend stays running or restarts.

| Run here                 | What happens                                           |
| ------------------------ | ------------------------------------------------------ |
| `npm start`              | Browser preview and native staging; no Electron window |
| `npm run build`          | Stage the app once                                     |
| `npm run native:dev`     | Open Electron with live reload                         |
| `npm run native:release` | Create a ZIP distribution with its backend included    |

## Try it

1. Run `npm run native:dev`, enter a number and calculate its square.
2. Save `index.js`: the frontend refreshes and the backend PID stays the same.
3. Edit `native/backend.cjs`, `native/app.cjs` or `native/preload.cjs`: the app and backend relaunch together.
4. Close the app: its backend stops too.

Keep edits in `native/`; generated files in `electron/` are copied from there. The browser preview explains that calculations need the native app.

<details>
<summary>Packaging, backend lifecycle and other runtimes</summary>

`npm run native:release` creates a ZIP distribution using Electron Forge. The backend is included inside the app; end users do not install Node. This example uses Electron's [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process) runtime. Files are resolved from the shell, so they work after packaging too. The renderer stays sandboxed with Node integration disabled and calls one validated operation through the preload bridge.

The small esbuild plugin copies changed files from `native/` into the generated `electron/` shell before building. Keep edits in `native/`. It leaves unchanged sources untouched so web saves do not accidentally restart the backend. Startup waits for the backend's ready message. Replies have request IDs and timeouts; backend exit rejects pending work. A reply timeout or broken IPC channel stops the backend and rejects all pending requests; restart the app to reconnect. Shutdown requests a graceful exit, then forces a stop if needed. The demo closes on every platform when its last window closes.

For Python, Go, an existing server or another standalone executable, replace the utility-process launch with a fixed `spawn` executable path. Package that executable and its runtime as a resource, resolve it from `process.resourcesPath` in packaged apps, and keep the same readiness/error/shutdown ownership. Do not depend on the user's PATH or put executable files inside an ASAR archive without unpacking them. The Tauri companion demonstrates a bundled executable.

</details>

<details>
<summary>Run the native verification checks</summary>

From the repository root, `npm run test:native:sidecars` tests the real Electron app, backend replies, invalid requests, frontend reload without backend restart and shutdown. `-- --release` checks its staged offline entry instead of the development URL; creating an actual ZIP remains `native:release`.

`npm run test:native:sidecars -- --packaged` builds an actual app distribution with Electron Packager and tests that packaged executable and its included backend. This requires packaging dependencies in addition to the UI runtime. It writes reports/screenshots under `.test-native/results`.

Add `--crash` to a check to stop its backend deliberately and verify that repeated requests report the failure and the app can still close. `tests/sidecar-failures.test.js` checks startup/reply timeouts, broken IPC, pending requests and forced shutdown without requiring Electron.

</details>
