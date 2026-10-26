# Standalone Node backend

From this folder, after installing the repository dependencies:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:8081` to see a JSON message and the requested path. Ctrl+C stops the server. `PORT` selects another listening port.

Edit the response in `server.ts`, then rebuild and restart. `tinybuild.config.js` builds for Node and keeps packages external; deploy installed production dependencies alongside the built script when you add them. This backend runs independently of the parent example's built-in API.
