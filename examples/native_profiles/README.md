# Share settings across native builds

```sh
npm start
```

The browser page explains the selected mode. `npm run build` stages Electron, Tauri, Android and iOS without launching their SDKs.

| Choose a workflow        | What it does                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `npm run devices`        | List Android devices/emulators and available iOS simulators on macOS                     |
| `npm run native:debug`   | Apply the debug profile, serve on the LAN, write a QR code and launch configured targets |
| `npm run native:release` | Apply the release profile and run its SDK packaging and signing commands                 |

Edit the shared app name, ID and permissions in `nativeApp(...)`. Change a value under `profiles.debug` or `profiles.release` to override it for that workflow. The demo's debug profile selects Electron and Android; disable an unused target before launching if you only want one of them.

Release requires your signing setup. Replace `sign-release.js` with your actual signing hook and provide its required environment values; the placeholder deliberately fails. Existing platform files and permission descriptions are preserved. See [desktop debugging](../desktop_debug/README.md) and [mobile live reload](../mobile_debug/README.md) for a single-target starting point.
