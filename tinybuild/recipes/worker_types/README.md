# Typed worker imports

## Run

```sh
npm install
npm start
```

Follow the printed URL. Stop development with Ctrl+C.

## Try it

Run `npm start` here for the live page. `npm run build` builds it once, and `npm run typecheck` checks the TypeScript.

`index.ts` imports `./math.Worker`, which resolves `math.Worker.ts`. Lowercase `.worker` works the same way; match the file's spelling on Linux. The default export is a worker URL, and `createWorker` creates a worker with that URL. The page sends 21, receives 42 and terminates its worker.

`math.d.Worker.ts` describes the URL and helper exports to TypeScript. `allowArbitraryExtensions` in tsconfig lets TypeScript use that companion file. For `./flow.worker`, name the companion `flow.d.worker.ts`. These declaration files contain types only; esbuild compiles the actual worker source. Full `.worker.js` and `.worker.ts` imports also remain available.

The full commented tinybuild.config.js is included. Use `blobWorkers: false` for emitted worker files or `bundleHTML: true` for an HTML file with an embedded worker.

To add another worker, run `npx tinybuild init --worker extra.Worker --typescript`. It creates `extra.Worker.ts` and `extra.d.Worker.ts`, and prints a usage example. Add the worker source to tsconfig's include list when you want it type-checked. Existing workers and config files are preserved. The complete starter is also available through `npx tinybuild init --example worker_types --dir demo` from an installed tinybuild.

Run `npm run check` to verify the build when needed. The complete `tinybuild.config.js` explains all settings. [Agent guide](node_modules/tinybuild/tinybuild/docs/agents.md).
