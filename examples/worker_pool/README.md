# A small worker pool

```sh
npm start
```

The page sends a buffer to one of two workers and displays `20, 40, 60`. Click **Cancel a slow job** to see cancellation without waiting for the work to finish.

- `index.js` creates the pool, queues calls and transfers buffers.
- `jobs.worker.js` handles the named jobs.
- `maxQueue` limits waiting jobs. `timeout` and `AbortSignal` cancel work; the pool replaces a cancelled worker.
- `pool.close()` stops the workers when the page is finished.

`npm run build` also creates a portable `dist/index.html`. The same job handlers work in Node by passing `parentPort` to `serveWorker`; `createWorkerPool<Methods>` adds TypeScript method checking.
