# Choose settings and check your app

```sh
npm run config
```

Choose a starting point, review the settings and build destinations, then confirm the save. The editor keeps your comments, imports and custom code and backs up the old config. Choose **current** to keep your existing workflow; library and Node recipes skip web-server questions.

| Run here          | Use it to…                                                  |
| ----------------- | ----------------------------------------------------------- |
| `npm run options` | Find worker settings and accepted values as JSON            |
| `npm run plan`    | Inspect outputs, watch folders and planned commands as JSON |
| `npm run check`   | Build and check this demo's script and homepage             |
| `npm run report`  | Collect selected settings and tool checks for support       |

These commands do not launch native SDKs. The project check starts its own temporary HTTP listener and closes it afterward. Edit `tinybuild.config.js` directly for callbacks, plugins and other custom code. `metadata` holds application-specific settings.

<details>
<summary>Edit from a script or consume development events</summary>

In an installed project, `npx tinybuild config --set '{"server":{"port":8081}}' --dryRun` previews an edit; replace `--dryRun` with `--yes` to save. JSON shell quoting differs on Windows. Calling the API avoids that quoting:

```js
import { configure } from "tinybuild";

await configure({
  edits: {
    server: {
      port: 8081,
    },
  },
  dryRun: true,
});
```

Use `npx tinybuild validate --strict` to catch config mistakes. `npx tinybuild dev --json` emits lifecycle events, one per line; use its ready/built URL instead of assuming port 8080. Build errors mark the server unready until the next successful build. The [agent guide](../../tinybuild/docs/agents.md) covers event fields, starter discovery and process cleanup.

</details>

<details>
<summary>What the support report contains</summary>

Reports include selected resolved settings, versions and tool checks. Environment values, headers, route bodies, command arguments and custom metadata are omitted; project/home prefixes and URL credentials/query values are redacted. Review filenames before sharing. Loading JavaScript config can run its own logging. Use `npm run check` for current build/file/URL errors; reports keep no history.

</details>
