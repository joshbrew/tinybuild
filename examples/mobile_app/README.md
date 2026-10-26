# Prepare a Capacitor app

```sh
npm run build
```

Inspect `mobile_dist` for the web app. The default `stage` action prepares files without running Android Studio, Xcode or a device.

To open a native project, change the active `mobile.android` or `mobile.ios` value in `tinybuild.config.js` to `"open"`. Tinybuild creates a missing platform project, syncs the web files and opens its IDE. That step needs the selected platform's tools; iOS needs macOS/Xcode.

Keep signing material outside source control. Add BLE or other native plugins explicitly to your app. For quick install/launch and live reload, use the [mobile debug example](../mobile_debug/README.md).
