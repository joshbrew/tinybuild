# Testing on another operating system

Keep platform tools outside tinybuild's everyday build path. The same config can build a browser app, serve it from Node, or stage a native shell. Real native runs use the SDKs for the operating system running the command.

## Release validation

```sh
npm run check:release
```

This runs the regression suite, types, all examples, an installed-package check, a 200-batch live-reload stress check and browser checks. The stress check includes ten-file saves, editor-style rename saves, deleted imports, syntax-error recovery, socket reconnection and repeated app sessions. It checks current served code, one successful reload per batch, stable watched-file counts, retained JavaScript heap and owned-backend cleanup. It uses temporary folders and leaves no repository reports. Chrome/Chromium must be available for the browser suite; `npx playwright-core install chromium` supplies a test browser when needed. `npm publish` refreshes shipped starters for the current package version, then runs this local validation through `prepublishOnly`.

Before publishing, run **release validation** in GitHub Actions against the intended commit, or push its matching `v<package-version>` tag. That workflow also requires native packaging on Linux, Windows and macOS, real Electron UI checks including a packaged sidecar and backend crashes, and Windows Tauri sidecar UI checks. Its npm tarball is available as `validated-npm-package` only after every required job passes. The workflow builds and validates artifacts; publishing is a separate explicit action. An untested tag does not count as a successful release check.

Device permissions/background behavior and credentialed signing still require the device and signing checks below on their prepared hosts. The release workflow's unsigned test builds do not certify those application-specific release requirements.

## Windows host, Ubuntu guest

Use an installed WSL 2 distribution. [Microsoft's WSLg guide](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps) explains Linux windows displayed on the Windows desktop. Install Node 22+ **inside Ubuntu**; Windows node_modules cannot supply Linux native packages.

From the repository root in Windows:

```powershell
npm run test:platform -- --wsl Ubuntu --node /usr/bin/node --suite core --install
npm run test:platform -- --wsl Ubuntu --node /usr/bin/node --suite browser --install
npm run test:platform -- --wsl Ubuntu --node /usr/bin/node --suite dev --example desktop_debug --port 8080
```

Replace `/usr/bin/node` with the absolute Linux Node executable. Without `--node`, the runner looks for `.test-platform/tools/node/bin/node` in the repository. It does not install an OS or download a Node runtime automatically. `--install` installs the guest's npm dependencies; browser mode also downloads its own Chromium. Install the browser's Linux system libraries separately, for example with `npx playwright-core install-deps chromium` inside the guest copy. This step may require guest administrator privileges.

The runner copies source into `/tmp/tinybuild-platform-<id>` inside Linux, leaving host dependencies, secrets, generated outputs and SDK builds out. Native shell **templates** are included. It refreshes source on each invocation and keeps guest dependencies while that temporary directory exists. Add `--install` if the guest has cleared its temporary files. Avoid concurrent runs against the same source copy. This is a convenient test environment, not a security sandbox for untrusted code.

In dev mode, save files in the Windows example normally. A polling watcher mirrors changes into the Linux example, where tinybuild rebuilds and reloads. Windows can usually open the printed `http://localhost:8080` address through WSL port forwarding. Ctrl+C stops the runner's child commands. If a guest session is interrupted abruptly, inspect its processes before starting another server on the same port.

Opening that URL in Windows Chrome tests the **Linux server and Windows browser**. The browser suite runs Linux Chromium, testing the Linux browser too. `--suite native-ui --install` installs the optional Linux Electron runtime and exercises its actual window. WSLg or a guest display server must be available; a headless Linux session can use Xvfb. `--suite dev --desktop electron` launches the live Linux Electron demo with DevTools. `--desktop tauri` needs Rust and Tauri's Linux prerequisites. Native runtime dependencies remain optional.

## Linux containers

Containers are useful for repeatable Node/server/browser tests. They [share a kernel](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/); a Linux image does not supply a Windows or macOS desktop.

With Docker already installed, this example runs the existing desktop demo as a Linux Node server. From the repository root in PowerShell:

```powershell
docker run --rm -it -p 127.0.0.1:8080:8080 --mount "type=bind,source=$PWD,target=/source,readonly" node:22-bookworm node /source/scripts/check-platform.js --guest --source /source --suite dev --host 0.0.0.0 --port 8080 --install
```

The source mount is read-only; dependencies and build outputs live in the container's temporary copy. Host edits remain visible to the polling watcher. Open `http://localhost:8080`. Use `--suite core` for a one-shot portable check. Linux browser/UI tests additionally need Chromium/Electron and display libraries; the optional native CI workflow shows an Xvfb setup. The Docker recipe is provided for installed Docker environments; the local cross-OS run uses Ubuntu WSL.

## Windows, macOS, Android and iOS targets

| Target             | Practical environment                                 | Debug from your main computer                                           |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Linux              | WSL 2, Linux VM, container or Linux machine           | Forward the dev-server port; use WSLg/remote desktop for native windows |
| Windows native app | Windows host, Windows VM or remote Windows machine    | Remote desktop plus the app's DevTools/debugger                         |
| macOS native app   | Mac or macOS VM on suitable Apple hardware            | Screen sharing/remote desktop plus forwarded dev/debug ports            |
| Android            | Android emulator or connected device with Android SDK | `tinybuild mobile=android --device <id>`; USB forwarding or LAN reload  |
| iOS                | Xcode simulator on a Mac or provisioned iOS device    | Run the SDK on the Mac; use LAN reload and its platform debugger        |

An OS image alone does not provide a licensed, running native desktop. Use a VM or remote machine for a different desktop OS; keep its SDK, dependencies and builds on that machine. SSH can forward a server/debugger port to the main computer. The existing manual native workflow builds on actual Windows/Linux/macOS runners, avoiding assumptions that cross-compilation proves native runtime behavior.

## Real native UI and signing checks

From the repository root:

```sh
npm install --prefix .test-native/runtime electron
npm run test:native:ui
npm run tauri:release --prefix examples/desktop_debug
npm run test:native:ui -- --tauri --application /absolute/path/to/tinybuild-app --webdriver http://127.0.0.1:4444
npm run test:native:signature -- /absolute/path/to/signed-artifact
```

The Electron UI check stages the desktop counter, opens a real Electron process, clicks it, checks renderer isolation and saves a screenshot/report in `.test-native/results`. It closes its processes on completion. It does not require an installer or signing credentials.

The Tauri check expects a running compatible WebDriver endpoint and the built desktop counter executable. It creates a session, checks rendering, clicks and closes the session. See [Tauri's testing guide](https://v2.tauri.app/develop/tests/webdriver/) for current driver setup and platform support; the direct `tauri-driver` path is available on Windows/Linux, while other integrations offer different macOS support. UI checks need a desktop/display environment and do not run during ordinary `npm run check`.

On Windows, install the MSVC Rust toolchain, Visual Studio C++ build tools and WebView2 described in [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/). Install `tauri-driver` with `cargo install tauri-driver --locked`, and download the Microsoft Edge WebDriver version matching the installed WebView2 runtime. Keep the driver running in one terminal:

```powershell
tauri-driver --native-driver C:\tools\msedgedriver.exe
```

In another terminal, build and exercise the demo:

```powershell
npm run tauri:release --prefix examples/desktop_debug
npm run test:native:ui -- --tauri --application "$PWD\examples\desktop_debug\src-tauri\target\release\tinybuild-app.exe" --webdriver http://127.0.0.1:4444
```

If you set `CARGO_TARGET_DIR`, use that folder instead of `src-tauri/target` for the executable path. The UI check closes its app session; stop the driver separately when finished. For development, `npm run tauri:dev --prefix examples/desktop_debug` uses tinybuild's live server. WebView2 can also expose a local debugging port for [Playwright automation](https://playwright.dev/docs/webview2); enable that only in the environment of the development/test process.

The [Electron sidecar](../../examples/electron_sidecar/README.md) and [Tauri sidecar](../../examples/tauri_sidecar/README.md) examples include the backend itself, its IPC bridge, startup readiness and shutdown handling. Portable checks stage them without installing SDKs. To exercise real processes:

```sh
npm run test:native:sidecars
npm run test:native:sidecars -- --packaged
npm run test:native:sidecars -- --tauri
npm run test:native:sidecars -- --tauri --release
npm run test:native:sidecars -- --tauri --installer
```

The Electron packaged check builds and launches a real distribution; `--release` alone checks its staged offline entry. Tauri checks currently use WebView2 automation on Windows. Development checks save two frontend files and require exactly one refresh with the same backend PID. Both targets reject invalid input and must stop their backend after the native app closes, before the test controller cleans up. Add `--crash` to either target's command to kill its owned backend and verify that repeated requests report its failure while the app can still close. Portable shell checks also exercise hung readiness, reply deadlines, broken IPC, forced shutdown and repeated sessions without an SDK. Screenshots and JSON reports use `.test-native/results/sidecar-*`. These reports and the `.test-*` dependency/build folders are disposable local artifacts; they are ignored by Git and may be removed after testing. The commands recreate reports, while optional runtimes/SDKs require their documented setup again. Keep ad hoc command logs in the system temporary directory. Native CI exercises Electron sidecars on its desktop runners and the Tauri release sidecar on Windows. Tauri binary-only output must be distributed with its companion executable; installer bundles include it automatically.

Signature verification calls Windows Authenticode, macOS `codesign --verify --deep --strict`, or Linux `gpg --verify` with an adjacent `.asc` signature. Linux needs the signer's trusted public key in the selected GPG environment. This verifies the specified artifact; it does not create certificates, sign a release, notarize it or prove every installer payload is signed. Configure `native.signing.command` for your real signing process and `native.signing.verify` for a verification command that checks all your produced artifacts. Both receive `TINYBUILD_ARTIFACT_DIRS`; failure stops the release workflow. Credentials stay in your environment.

## Windows installer smoke test

On a disposable Windows runner/VM with the Tauri SDK, run `npm run test:native:sidecars -- --tauri --installer`. It builds a per-user NSIS installer, refuses an existing destination, installs into a fresh test folder, launches the installed app with Node/Rust/Cargo directories removed from PATH, exercises the UI and sidecar, closes the app, verifies backend exit and runs the uninstaller. Cleanup also runs after a failed assertion or cancellation. The native release workflow includes this job.

The check changes per-user installation entries and should run in a test account. It validates NSIS only; other Windows installers and macOS/Linux package formats need their own installation tests. It does not certify signing or prove an OS without development tools was used. Its command handling follows [NSIS's documented silent installation/uninstallation rules](https://nsis.sourceforge.io/Docs/Chapter3.html#installerusage). Leftover data is preserved instead of recursively deleted.

## Existing application compatibility

```sh
npm run test:stacks -- --install
npm run test:stacks -- --reuse
```

The harness checks the named sibling repositories, including backend configs, in isolated `.test-stacks` copies. npm lifecycle scripts are disabled during dependency installation, and native actions, servers and auto-install are disabled during builds. A JSON report records outputs, warnings and errors; original config hashes are checked afterward. These checks expose integration problems without modifying the original applications or starting their external services. Missing application exports or entry files must be corrected in that application's sources rather than hidden by tinybuild.

Use `npm run test:stacks -- --stack webgpujs --install` to check its browser, ESM and declaration builds with the project's TypeScript compiler.

Select the WebGPU applications with `npm run test:stacks -- --stack uplot-webgpu,vibe_code_experiments/noiseCompute --install`. After those copies build, `npm run test:stacks:browser` starts them with their existing configs, runs Chrome/Chromium, verifies rendering signals and worker results, captures screenshots, and closes owned servers/browser processes. It uses the configured ports 8080 and 8082; stop another process using those ports first. This browser check requires a working WebGPU adapter. It does not change app sources or config flags to force a pass.

On Windows Chrome with the NVIDIA adapter, uplot-webgpu passed 116 gallery results and an eight-worker live dashboard. noiseCompute's worker-backed flat-cloud first frame and planet scene rendered without script, resource or GPU console errors. Reports/screenshots are under `.test-stacks`. Its original configs were preserved. Declaration generation now resolves app-local type packages relative to that app and recognizes esbuild CSS side-effect imports without adding files to the application's sources.

## Named remote computers

Define remotes.mac or remotes.windows using the complete config template. `tinybuild --remote mac --dryRun` prints the plan; omit dryRun to connect. The [native lifecycle example](../../examples/native_lifecycle/README.md) includes both presets: host alias, remote directory, program/arguments, forwarded ports and readiness URL.

Mac/Linux commands use POSIX quoting; Windows uses encoded PowerShell with literal arguments. Keys, host trust and aliases use your existing SSH setup. Configure noninteractive access first with your normal SSH client. Ports bind only to local loopback, with keepalives and forwarding-failure detection. Source synchronization and SDK installation stay separate. Native GUI windows need an interactive session/display; SSH alone does not supply a desktop. See the [OpenSSH reference](https://man.openbsd.org/ssh).

## Device lifecycle and permissions

```sh
npm run test:mobile -- --platform android --id com.example.lifecycle --device emulator-5554 --artifact /path/to/app.apk --permissions android.permission.CAMERA --relaunches 2 --dryRun
npm run test:mobile -- --platform android --id com.example.lifecycle --device emulator-5554 --artifact /path/to/app.apk --backgrounds 2 --backgroundDelay 1000 --dryRun
```

Remove dryRun for your chosen test app/device. The checker installs/launches the artifact, checks its process, cycles explicitly named Android runtime permissions through deny/grant, checks OS permission state and relaunches. `--backgrounds 2` sends Android to its home screen and resumes the app twice, waiting `--backgroundDelay` milliseconds each time without force-stopping it. It restores the original permission grants and attempts to return a backgrounded app to the foreground even after assertion failure/cancellation. `--reconnectPort 8080` temporarily removes an existing USB reverse mapping and restores its original destination; start USB live reload first. It does not reset app data, uninstall, reboot or create an emulator. See [Android's adb reference](https://developer.android.com/tools/adb).

The checkMobileLifecycle API accepts verify(checkpoint) for your own UI driver to assert denied/granted screens, resumed state, reconnection or data persistence. OS process checks alone cannot prove application UI behavior. watchAppLifecycle supplies browser visibility/connectivity events and optional Capacitor App state events, with cleanup across hot reload. iOS simulator relaunches are supported; permission UI needs a platform driver. No device was provided for local execution.

## macOS tickets and notarization

```sh
npm run test:native:signature -- /path/to/MyApp.app --notarized --dryRun
npm run test:native:signature -- /path/to/MyApp.app --notarized
npm run test:native:signature -- /path/to/MyApp.app --submit --archive /path/to/signed-app.zip --profile my-notary-profile
```

The first command plans only. On a Mac, notarized verification requires a valid signature, a stapled ticket and successful Gatekeeper assessment. Apps, disk images and packages use their appropriate verification commands.

Submission requires the explicit --submit action. It uploads the signed archive with notarytool using an existing keychain profile, waits for an Accepted JSON result, staples and verifies. It does not sign or create credentials. Rejected results stop before stapling. Use notarizeMac/verifyMacRelease from scripts invoked by native.signing hooks. An app ZIP needs the separate .app path for stapling. See [Apple's workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow). Actual notarization requires your Mac and Apple signing setup; portable tests cover plans and failure handling.

## Local verification

- October 26, 2026 on Windows: 338 regression tests, API types, all 41 examples, packed-package installation and eight browser suites passed. Packed-install walkthroughs covered empty-folder build/serve/shutdown, the JavaScript and typed-worker starters, a Node API, native staging and support reports. Fresh isolated builds passed for webgpujs, uplot-webgpu, noiseCompute, webgl-plot-utils, both myalyce_dev configs and autogpt_web_dev_server. Real compiler checks passed with TypeScript 5.9.3, 6.0.3 and 7.0.2, covering declaration maps, ambient/CSS types, non-writing builds and recovery. Webgpujs built with its project-local TypeScript 7.0.2 and all 12 declaration files. Declaration errors were reported once with exit code 1. Chrome verified both WebGPU applications, including one refresh per two-file save. The 200-batch reload run published 200 successful reloads with one rebuild per batch, recovered from 80 intentional source failures, held 13 watched entries and approximately 11–13 MiB of retained JavaScript heap, and closed its owned backends. Real Electron development, packaged distribution and backend-crash checks passed. Disposable test copies/runtimes and command logs were removed afterward. The GitHub release matrix, current Tauri SDK/installer runs, physical-device checks and macOS signing were not executed in this pass. Device and Mac checks are prepared for hosts supplied later; GitHub workflow execution also requires an authenticated account and the workflow on a pushed branch.
- October 23, 2026 pre-push check on Windows: 256 regression tests, public API types, all 40 examples, packed-package installation, eight browser suites and five Python server tests passed. Packaged Electron and release Tauri sidecars passed real UI, request-validation and backend-shutdown checks. Generated logs, copied test apps, downloaded tools and build caches were removed afterward; the results recorded here remain the durable validation summary.
- October 20, 2026: Windows Node 22.18.0 and Ubuntu 24.04/WSL Node 22.23.3 passed 256 regression tests, public API type checks, all 40 example builds and packed-package installation.
- October 20: all eight browser suites passed on Windows Chrome and Ubuntu Chromium, including portable HTML workers, mixed-save/error recovery and interactive examples.
- October 20: fresh isolated uplot-webgpu and noiseCompute copies built using their existing configs. Chrome verified uPlot's 116 gallery results and eight-worker dashboard, plus noiseCompute's flat-cloud and planet scenes. A two-file save caused exactly one reload in each app; no script, GPU console or resource errors were captured. Original config hashes were unchanged and owned servers/browser processes closed.
- October 20: Electron 44.8.0 real counter clicks and renderer-isolation checks passed on Windows and Ubuntu. Windows Authenticode verification passed against the installed signed Node executable on October 18; this does not constitute signing a tinybuild release.
- October 20: a fresh Windows Tauri shell built through tinybuild using Rust 1.99.1/MSVC, Tauri CLI 2.12.3 and Tauri 2.12.4. The release executable rendered the desktop demo and passed a real button click through tauri-driver 2.1.0 and matching Edge/WebView2 155.0.4283.62. Test tools, Cargo caches, app copies and screenshots were kept under ignored `.test-native` folders without changing the global Rust toolchain or PATH.
- October 20: the same Tauri shell passed real Windows development checks through WebView2's debugging connection: counter clicks, exactly one page refresh for a two-file save, a visible syntax-error overlay with readiness 503, recovery to readiness 200 after repair, and no renderer errors. The development server stayed in place during edits; owned app/driver processes and the server were confirmed stopped afterward. Reports/screenshots are `.test-native/results/tauri-windows-ui.*` and `tauri-windows-live.*`.
- October 20: the two new sidecar demos passed real Windows UI checks: Electron development, staged offline and packaged distribution (Electron 44.9.2), plus Tauri development and release binary with its bundled backend. Calculations, rejected invalid requests and backend shutdown passed. Development two-file saves produced one refresh without changing the backend PID. Reports/screenshots are `.test-native/results/sidecar-*`. All eight Windows browser suites also passed with the new native-only preview pages.
- October 20: Electron's Node sidecar also passed a real Ubuntu/Xvfb UI run: calculations, invalid-input rejection, one refresh for a two-file save with the same backend PID, and backend shutdown after the app closed. The guest report/screenshot use the same `sidecar-electron-dev.*` filenames in the isolated guest project; generated logs and reports are disposable and are not committed.
- October 18 live host/guest editing: a two-file Windows save produced one Linux rebuild/reload, the server remained reachable, files were restored, and the owned guest server stopped cleanly.
- Existing stacks: webgl-plot-utils, both myalyce_dev configs and autogpt_web_dev_server passed. Bangle's frontend imports missing CSV exports (`processDataForCSV`, `parseCSVData`); its backend config names missing `contentserver.ts`/`dataserver.ts` files where the checkout has `.js` counterparts. Original application sources were preserved.

macOS execution/signing, credentialed release signing and Docker execution were not performed locally. The optional SDK/driver checks, CI workflow and container recipe describe how to run those checks in a suitable environment.
