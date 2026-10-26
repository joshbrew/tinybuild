# Lifecycle, permissions and remote hosts

## Try the browser demo

```sh
npm start
```

Hide the page, switch apps or toggle offline mode in DevTools; the status updates. Click **Check camera permission** to read its current state without requesting access. Saved script edits remove the previous lifecycle subscriptions before restarting the demo.

## Add native app events

The default native build only stages Android/iOS, with camera permission descriptions. For a real Capacitor app, install @capacitor/app and @capacitor/camera and enable the native-adapter.js import at the top of index.js. App supplies native background/resume events; Camera supplies real native permission state. Browser-only use needs neither plugin. Add @capacitor/app to native.plugins when using the native adapter so native sync installs it too.

## Preview checks without a device or host

| Command                       | Prints a plan for                                            |
| ----------------------------- | ------------------------------------------------------------ |
| `npm run device:plan`         | Android install, permissions, background/resume and relaunch |
| `npm run mac:plan`            | macOS signature, ticket and Gatekeeper checks                |
| `npm run remote:mac:plan`     | SSH connection to a Mac/Linux preset                         |
| `npm run remote:windows:plan` | SSH connection to a Windows preset                           |

`npm run device:plan` prints the Android install/launch, grant/deny and relaunch cycle without a device. To execute on your chosen **test app/device**, run the root test:mobile command with the actual APK, app ID and device. An existing USB reverse port can be disconnected/reconnected deliberately. Actual runs restore the original runtime permission grants and reverse destinations in cleanup. Use checkMobileLifecycle's verify callback to assert application-specific UI, server reconnection or saved state at each checkpoint; OS-level process checks alone cannot prove the UI handled those transitions. iOS simulator checks support relaunches; its permission UI needs a platform-specific driver.

`npm run mac:plan` prints signature, stapled-ticket and Gatekeeper checks. The [platform guide](../../tinybuild/docs/platform-testing.md) shows actual verification and optional notarization through a preconfigured keychain profile. No credentials or uploads are needed for plans.

## Android background and resume

Android device checks accept `--backgrounds 2 --backgroundDelay 1000` to press Home, wait one second and reopen the app twice without force-stopping it. The `backgrounded` and `resumed` verification checkpoints let your UI driver assert retained state. If a background assertion fails, cleanup attempts to reopen the test app even after cancellation. These steps operate on your explicitly selected device/app; no emulator is created.

## Connect an existing remote computer

The two remote plan scripts show SSH arguments for Mac/Linux and Windows presets. Replace host aliases/directories with your own machines before connecting with `tinybuild --remote mac` or `--remote windows`. Those machines need a checked-out app, dependencies, Node and any native SDKs already installed. SSH keys and host trust use your normal SSH setup. Source copying is separate. Ports bind only to local loopback. For Windows native windows, use an interactive remote desktop session; SSH server sessions may not have an interactive desktop. See [remote development](../../tinybuild/docs/platform-testing.md).
