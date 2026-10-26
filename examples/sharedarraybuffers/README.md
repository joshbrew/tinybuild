# Share or transfer memory to a worker

```sh
npm start
```

Open the printed URL. One worker fills a shared buffer; another receives and returns a transferred buffer. The page reports 65,536 filled pixels and 262,144 returned bytes, then stops both workers.

- `index.js` creates buffers and sends the jobs.
- `worker.js` uses shared memory.
- `nonshared.worker.js` handles the transferred buffer.

The server config sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. These headers let supported browsers enable shared memory. Use the configured server; the page explains when cross-origin isolation or SharedArrayBuffer is unavailable. Measure performance on the devices you intend to support.
