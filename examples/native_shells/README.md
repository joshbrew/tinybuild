# One web app, four native targets

Stage one web build for Electron, Tauri, Android and iOS:

```sh
npm run build
```

This prepares files without downloading an SDK or opening an app.

| Look in        | Find                           |
| -------------- | ------------------------------ |
| `electron/web` | Electron's staged web app      |
| `src-tauri`    | Tauri shell and staged web app |
| `mobile_dist`  | Web assets for Android and iOS |

The [config](tinybuild.config.js) enables portable HTML: imported workers and assets are embedded in the page. Explicit `assets` folders are copied alongside it.

## Open an app

With the target's tools installed, choose one command:

```sh
node ../../tinybuild/bin/global.js desktop=electron
```

```sh
node ../../tinybuild/bin/global.js mobile=android --device <id>
```

These shortcuts load the running development server. Edit the web source to see a live update. The [desktop and mobile guide](../../tinybuild/docs/tinybuild.md#desktop-and-mobile-apps) covers debugging and device selection.

<details>
<summary>Staging and reload settings</summary>

Change a target's `action` to open or build it with that platform's tools. Keep extra asset paths distinct from generated output: two files cannot both become the staged `index.html`. Private environment and signing files are rejected.

Production staging uses the server's public root. A portable HTML build supplies its own entry page, so a separate project `index.html` is optional.

`electron.watch` relaunches after main/preload edits. Restart tinybuild after changing native launch settings or the server's address. Source, style, header and reload-delay edits keep the current workflow. Live reload requires development mode in both the top-level config and server settings.

</details>
