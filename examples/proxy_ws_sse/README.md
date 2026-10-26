# Proxy a WebSocket app

In one terminal in this folder:

```sh
node backend.js
```

In a second terminal in the same folder:

```sh
npm start
```

Open the printed URL. The page talks to a separate echo server through tinybuild's WebSocket proxy. The development reload connection uses SSE (a browser event stream) on the same tinybuild server.

Edit `index.js` and save to see live reload while the proxy remains available. Binary messages and negotiated subprotocols pass through. Ctrl+C stops each terminal's process; stopping tinybuild also closes its proxied connections. Production keeps the app proxy and disables the development reload stream.
