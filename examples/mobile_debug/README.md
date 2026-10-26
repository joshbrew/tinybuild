# Launch a phone app with live reload

Start with `npm start` for the browser preview, or `npm run build` to stage Android/iOS files without an SDK.

## Launch on a prepared device

```sh
npm run devices
npm run android:dev -- --device emulator-5554
```

Replace the device ID with one from the list. Android uses USB port forwarding by default, including the actual chosen server port. For a wireless device, add `--connection lan`; use `--connection emulator` when selecting that connection mode explicitly.

On a prepared Mac, use `npm run ios:dev -- --device <simulator-id>`. A physical iOS device uses `--connection lan`. Launching builds, installs and opens the app; later web saves rebuild and reload it. HTTPS devices must trust the development certificate.

## Try it

Increment the counter, edit `index.js` and save. The demo removes its old UI and keeps the count. Source edits keep the web server running; server configuration edits may replace its listener. Ctrl+C stops the session. The temporary development URL is not saved into Capacitor config.

## Check an existing APK

From the repository root, preview the check first:

```sh
npm run test:mobile -- --platform android --artifact /path/to/app.apk --device emulator-5554 --id com.example.app --dryRun
```

Supply your APK, device and app ID. Omit `--dryRun` to install and verify the app process. Use `--platform ios` with a simulator `.app` on macOS. [Device checks and platform setup](../../tinybuild/docs/platform-testing.md#device-lifecycle-and-permissions).
