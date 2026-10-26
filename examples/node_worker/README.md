# Node.js worker

Run work in a separate Node thread instead of a browser worker.

```sh
npm run build
node dist/index.js
```

The terminal prints the worker answer and exits. `index.js` imports the emitted path and creates a `node:worker_threads` worker; `task.worker.js` contains its work.
