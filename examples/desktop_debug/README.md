# Desktop debug

From this folder, start a browser preview:

```sh
npm start
```

For a native window, choose one workflow. Electron needs its runtime; Tauri needs [Rust and the platform prerequisites](https://v2.tauri.app/start/prerequisites/).

| Run                        | Try it for                                                                  |
| -------------------------- | --------------------------------------------------------------------------- |
| `npm run build`            | Stage Electron and Tauri folders without SDK commands                       |
| `npm run electron:dev`     | Live web reload, renderer DevTools and main-process inspection on port 9229 |
| `npm run electron:watch`   | Live web reload plus automatic relaunch after main/preload edits            |
| `npm run tauri:dev`        | Live web reload plus Tauri's Rust watcher                                   |
| `npm run electron:release` | Build an Electron ZIP                                                       |
| `npm run tauri:release`    | Build a Tauri binary without an installer                                   |

Follow the printed URL for a browser preview. Stop a running workflow with Ctrl+C. The complete [config](tinybuild.config.js) includes the debug and release profiles.

## Try a relaunch

Run `npm run electron:watch`, then edit `electron/electron_app.js` and `electron/electron_preload.js` together. Electron relaunches once after the saves settle. Edit `index.js` to update the web page within the current app.

`electron.watch: true` watches the shell's package main entry and preload. Use a path array for additional main-process files. `restartDelay` controls how long edits are grouped; this profile uses 150 ms. Tauri handles Rust edits with its own watcher; `tauri.watch: false` turns it off.

Restart tinybuild after changing native launch settings or the server's host, port or protocol. Source, style, header and reload-delay edits stay live.

<details>
<summary>Snapshots and custom shells</summary>

`liveReload: false` loads the staged files; restart tinybuild to refresh them. A watched Electron shell can run with `server: false` when you only need main/preload relaunches. Live web reload requires development mode in both the top-level config and server settings.

Existing shell source is preserved. Custom Electron shells use `TINYBUILD_DEV_URL`, `app.isPackaged` and `tinybuild-app.json` for these launch conveniences. Generated shells keep the renderer sandboxed and ignore development URLs and DevTools settings when packaged. [Electron's debugging guide](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process) covers attaching a debugger.

Tauri's generated overlay uses the actual listening URL and a development CSP. `native.tauri` can override advanced values. Existing `beforeDevCommand` hooks must not start a second frontend server.

</details>

<details>
<summary>Release output and signing</summary>

After packaging, the CLI lists output directories and their immediate contents. Programmatic results expose `artifacts`; JSON mode emits an `artifacts` event. Existing older files can appear in these listings. Distribute whole app folders with their resources and sidecars, or use an installer bundle.

Tauri accepts `features`, `target`, `debug`, `noBundle` and `bundles`. Release plans report `artifactDirectories`; custom Cargo workspaces may use a different output layout.

Signing hooks receive `TINYBUILD_ARTIFACT_DIRS` as a JSON array. `native.signing.verify` runs after signing and fails the build if verification fails. The repository's `test:native:signature` script checks a supplied artifact with the host OS tool. A directory listing alone does not verify an installer, signature or sidecar.

See [platform testing](../../tinybuild/docs/platform-testing.md) for native UI checks and Linux apps launched from Windows. Native CI is manually dispatched and builds on Windows, Linux and macOS.

</details>
