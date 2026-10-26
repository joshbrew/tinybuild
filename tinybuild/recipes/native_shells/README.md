# One web app, four native targets

## Run

```sh
npm install
npm run build
```

Staging prepares native app folders without opening an SDK or server.

## Try it

Stage one web build for Electron, Tauri, Android and iOS:

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
npx tinybuild desktop=electron
```

```sh
npx tinybuild mobile=android --device <id>
```

These shortcuts load the running development server. Edit the web source to see a live update. The [desktop and mobile guide](node_modules/tinybuild/tinybuild/docs/tinybuild.md#desktop-and-mobile-apps) covers debugging and device selection.

<details>
<summary>Staging and reload settings</summary>

Change a target's `action` to open or build it with that platform's tools. Keep extra asset paths distinct from generated output: two files cannot both become the staged `index.html`. Private environment and signing files are rejected.

Production staging uses the server's public root. A portable HTML build supplies its own entry page, so a separate project `index.html` is optional.

`electron.watch` relaunches after main/preload edits. Restart tinybuild after changing native launch settings or the server's address. Source, style, header and reload-delay edits keep the current workflow. Live reload requires development mode in both the top-level config and server settings.

</details>

Run `npm run check` to verify the build when needed. The complete `tinybuild.config.js` explains all settings. [Agent guide](node_modules/tinybuild/tinybuild/docs/agents.md).
