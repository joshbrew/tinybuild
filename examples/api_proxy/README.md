# Use a backend through the web server

In one terminal in this folder:

```sh
node backend.js
```

In a second terminal in the same folder:

```sh
npm start
```

The page requests `/api/hello` from its own server. Tinybuild forwards the request to the backend on port 8090 and returns the reply. Edit `index.js` for the page or `backend.js` for the API; restart the separate backend after editing it. Stop each terminal with Ctrl+C.

`server.proxy` configures the destination, path prefix, headers, timeout and body size limit. For WebSocket forwarding, enable `ws: true`; the [WebSocket proxy example](../proxy_ws_sse/README.md) shows that workflow.
