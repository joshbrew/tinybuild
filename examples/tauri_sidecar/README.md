# Tauri with a bundled executable

Run a small calculation backend as a separate executable. Tauri owns its startup, requests and shutdown; the frontend uses one private command.

| Run here                   | What happens                                            |
| -------------------------- | ------------------------------------------------------- |
| `npm start`                | Browser preview and native staging; no Rust compilation |
| `npm run build`            | Stage the app once                                      |
| `npm run native:dev`       | Compile and open the native app with web live reload    |
| `npm run native:release`   | Build the app and backend without an installer          |
| `npm run native:installer` | Build installer bundles containing both executables     |

## Try it

On a host with the Tauri build tools, run `npm run native:dev`, enter a number and calculate its square. Save `index.js`: the page refreshes while the backend process ID (PID) stays the same. Close the app: the backend stops too.

Restart this development command after changing `backend.rs` or the custom Rust shell in `native/`, so the executable is compiled and launched again. This example disables Tauri's Rust watcher to keep frontend saves from causing a second app restart. It demonstrates hot reload of web code and an explicit restart for compiled backend changes.

The browser preview disables the native-only button. Edit web code in `index.js`, the backend in `backend.rs`, and the shell in `native/main.rs`.

## Distribute it

`npm run native:release` builds the release executable and its companion backend without an installer. **Distribute the whole output folder, including the sidecar, rather than only the main .exe.** `npm run native:installer` builds the host's normal installer bundles, which include the external binary automatically. Signing/notarization must include the backend as well as the app. Rust, C++ tools and WebView2 are build prerequisites on Windows; the end user does not need Rust.

<details>
<summary>Sidecar compilation and request handling</summary>

`native/` contains the custom Rust shell. A small esbuild plugin copies changed source files into generated `src-tauri/` without touching unchanged files. `backend.rs` is a deliberately small, dependency-free example; replace it with your Python/Node/Go program compiled as a standalone executable when useful. A Node or Python script alone does not include its interpreter.

Tauri's `beforeDevCommand` and `beforeBuildCommand` run `prepare-sidecar.mjs`. It compiles the backend for `TAURI_ENV_TARGET_TRIPLE` (or the Rust host) into `src-tauri/binaries/tinybuild-math-backend-<target>[.exe]`. The config's `bundle.externalBin` uses the name **without** that target suffix; the Rust shell plugin resolves the installed executable. Cross builds also require the target's Rust libraries, linker and any backend runtime. See [Tauri sidecars](https://v2.tauri.app/develop/sidecar/).

Only the Rust shell launches the backend. The renderer can invoke the validated `calculate` command and cannot request arbitrary programs or arguments. A mutex pairs each reply with its request; readiness and reply deadlines stop a stuck backend. If it exits, the UI reports the failure; restart the app to reconnect. Closing the parent's input pipe also lets this backend exit if the parent disappears. Keep logs on stderr, because stdout carries protocol replies. No shell-spawn permission is exposed to the frontend.

</details>

<details>
<summary>Run native UI, failure and installer checks</summary>

From the repository root, `npm run test:native:sidecars -- --tauri` checks the real Windows development window through WebView2. Add `--release` to build and run the offline release app. The check verifies calculations, invalid requests, backend PID preservation across a two-file save in development, and backend shutdown. It writes screenshots and reports under `.test-native/results`. Other hosts can run the example directly or adapt the existing WebDriver checker to this page.

Add `--crash` to either check to stop the owned backend deliberately, verify that repeated requests report its failure, and close the app afterward.

On a disposable Windows runner or VM, `npm run test:native:sidecars -- --tauri --installer` builds an NSIS installer, installs into a new test folder, exercises the installed UI/backend and uninstalls it. The installed process starts with Node/Rust/Cargo directories removed from PATH. This check writes per-user installation entries, so use a clean test account rather than your everyday desktop. Existing installation folders are refused, backend shutdown is verified before uninstall, and leftover data is preserved. The native CI workflow runs this check on its Windows runner. Linux/macOS installers require checks for their own package formats.

</details>
