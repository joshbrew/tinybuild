# Browser worker

Move a job off the page thread with an ordinary worker URL import.

```sh
npm start
```

The page sends a message to `worker.js` and displays its uppercase reply. Change the reply in that worker and save to rebuild it. `index.js` shows startup, messaging and cleanup.
