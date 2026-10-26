# Add native features with a browser fallback

```sh
npm start
```

Click **Save a demo note**. In a browser, the note goes into `sessionStorage`; the page needs no native plugins. `index.js` shows how the same action selects a browser or native implementation.

## Use the native file action

Install the plugin versions matching this example's Capacitor 8 presets:

```sh
npm install @capacitor/filesystem@8 @capacitor/camera@8 @capacitor/local-notifications@8
```

Enable the `./native-adapter.js` import at the top of `index.js`, then launch with the [mobile debug workflow](../mobile_debug/README.md).

The native note action writes a file through the Filesystem adapter. Camera, files and notification presets supply plugin dependencies and native declarations; they do not replace your app's runtime permission handling.

<details>
<summary>Permissions, privacy declarations and secure storage</summary>

Request notification permissions before scheduling and handle denied camera/photo access. Handle restored app results if Android recreates your app during a native action.

For iOS files, add the required PrivacyInfo.xcprivacy declarations and select the permitted file-timestamp reason that matches your app. This preset does not choose privacy/legal assertions for you. Shared document access and exact alarms also require app-specific declarations; defaults request neither.

For secure storage, choose an encrypted storage provider and put its package name/version in the preset:

```js
{
  name: "secureStorage",
  plugin: {
    name: "your-chosen-provider",
    version: "...",
  },
}
```

Supply that provider's adapter to your own bridge; there is no plaintext fallback for secrets. Existing SDK projects and usage-description text are preserved.

References: https://capacitorjs.com/docs/apis/camera, https://capacitorjs.com/docs/apis/filesystem, https://capacitorjs.com/docs/apis/local-notifications.

</details>
