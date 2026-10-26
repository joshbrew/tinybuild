# Make a page available offline

```sh
npm start
```

Open the printed localhost URL. Let the service worker finish installing, refresh once, then switch the browser's Network tools to **Offline** and refresh again. The generated page and its built assets are cached for offline use. Switch back online before continuing development.

`index.js` registers `/service-worker.js`. `server.pwa` tells tinybuild where to generate it, using the actual build outputs. Use localhost or HTTPS; opening the HTML directly from disk does not register a service worker.

Deploy the worker, HTML and assets together. Customize your app's manifest and icons, and keep the configured `Service-Worker-Allowed` response header when deploying this example.
