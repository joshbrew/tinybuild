# Run a backend with your web app

```sh
npm start
```

Tinybuild runs `prepare.js`, starts `backend.js`, waits for its HTTP readiness check, then builds and serves the page. Follow the printed web URL.

Edit the response in `backend.js` and save. Its task restarts automatically; refresh the page to request the new response. Ctrl+C stops tinybuild and the backend it owns. `npm run build` only builds the frontend and starts no services.

`tasks` in `tinybuild.config.js` describes the commands, dependency order, readiness and watched files. Add another service that depends on `api` when it needs that backend running first. Tinybuild stops dependents before restarting their dependency.

The demo's backend uses port 8099. If that port is busy, change it in both `backend.js` and the config. Keep generated task files outside watched source folders, or add them to the ignore list.
