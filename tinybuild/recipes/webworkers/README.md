# Browser worker

## Run

```sh
npm install
npm start
```

Follow the printed URL. Stop development with Ctrl+C.

## Try it

Move a job off the page thread with an ordinary worker URL import.

The page sends a message to `worker.js` and displays its uppercase reply. Change the reply in that worker and save to rebuild it. `index.js` shows startup, messaging and cleanup.

Run `npm run check` to verify the build when needed. The complete `tinybuild.config.js` explains all settings. [Agent guide](node_modules/tinybuild/tinybuild/docs/agents.md).
