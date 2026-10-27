# Builds, workers and assets

Choose any combination of `bundleBrowser`, `bundleESM`, `bundleNode`, `bundleCommonJS`, `bundleIIFE` and `bundleTypes`. Formats can be booleans or individual esbuild option objects; `outputs.browser`, `outputs.esm`, `outputs.node`, `outputs.commonjs` and `outputs.iife` provide format-specific overrides. Use `outdir` for multiple entry files, or a `bundler` array for separate builds.

Build groups run in array order, so a later group can import an earlier group's generated files. Put a library before its example app or another consumer. Live rebuilds reuse esbuild contexts; saved files are grouped using `server.delay` before compilation.

Browser scripts use IIFE by default; ESM and Node builds use ESM. CommonJS output uses `.cjs`. Multiple formats have separate output paths. Node builds leave installed packages external so native bindings and package-owned files can load normally; deploy production dependencies alongside the output, or use `packages: "bundle"` to include compatible JavaScript dependencies.

Starter builds use `minify: true` and `sourcemap: false`. Set `minify: false` to choose individual options such as `minifyWhitespace` without enabling every minification step.

TypeScript declaration output is independent of JavaScript formats. The supplied `tsconfig.json` uses `moduleResolution: "Bundler"` and `noEmit` for source checking; `bundleTypes` writes declarations separately and reports declaration errors. Its comments explain browser, React and NodeNext setups. See the [TypeScript example](../../examples/default_ts/README.md).

Declaration builds support TypeScript 5.6–5.x, 6.x and 7.x. They use the project's installed compiler, falling back to tinybuild's installation when the project has none. Install one with `npm install --save-dev "typescript@>=5.6 <8"`. The same `bundleTypes: true` setting works across these versions: 5/6 use the JavaScript API; 7 uses the installed `tsc` command. Native compiler defaults and source diagnostics follow the selected TypeScript version. Config files are preserved, CSS side-effect imports are recognized, declaration maps point back to source, and `write: false` returns declarations without publishing files. Failed declaration builds preserve existing declarations and return a nonzero CLI exit code.

The built-in plugins support:

- **Workers:** imports ending in `.worker` or `.Worker`, full filenames such as `.worker.js` and `.worker.ts`, plus `worker.js` and `worker.ts`.
- **Remote imports:** cached HTTP(S) modules, relative imports and redirects. `remoteImports.frozen` requires cached files; `refresh` downloads fresh copies.
- **Dependency installation:** development builds can install missing packages with the project's package manager. Set `autoInstall: false` to require installed dependencies.

Use `plugins` for custom esbuild plugins. Same-name plugins and explicit loaders override the defaults; `includeDefaultPlugins: false` selects your own plugin set.

`copy` supports watched asset copying and removal of stale generated files. `assets` includes additional files in native distributions. See [asset_copy](../../examples/asset_copy/README.md) and [asset_pipeline](../../examples/asset_pipeline/README.md).

## Workers and portable HTML

Use `import workerURL from "./flow.worker"` for `flow.worker.js` or `flow.worker.ts`. The `.Worker` spelling works too: `"./flow.Worker"` resolves `flow.Worker.js` or `flow.Worker.ts`. Resolution follows your esbuild aliases, TypeScript paths and extension order; match the filename's case on Linux. Full filenames continue to work. A source file literally named `flow.worker` or `flow.Worker` contains JavaScript by default; choose a different loader explicitly if needed.

Workers inherit `bundler.logLevel`; `workerBundler.logLevel` overrides it for worker builds. Errors still reject the build when logging is silent.

For TypeScript checking, add a companion such as `flow.d.worker.ts` describing the URL and factory exports, and enable `allowArbitraryExtensions` in tsconfig. The [typed worker example](../../examples/worker_types/README.md) includes both files. This lets the type checker understand the value returned by the bundler plugin.

Create these files inside an existing project with the CLI:

```sh
tinybuild init --worker src/flow.Worker
tinybuild init --worker src/math.worker --typescript
tinybuild init --worker src/jobs.worker --typescript --workerRuntime node
```

The command prints a usage example and any required build/type-check settings. It preserves existing files and config; a conflicting worker name fails before writing. `--dryRun --json` previews the result without creating files. `tinybuild init --example worker_types --dir demo` creates a complete typed-worker starter instead.

Import a worker's URL and use the normal Worker API:

```js
import workerURL from "./task.worker.js";

const worker = new Worker(workerURL);
worker.postMessage("hello");
```

The same module offers optional lifecycle helpers:

```js
import { createWorker } from "./task.worker.js";

const worker = createWorker();
worker.postMessage("hello");
// Stop it when the app no longer needs it.
worker.terminate();
```

Blob workers are the default. The factory manages its blob URL as workers start and terminate; `revokeWorkerURL` is available for explicit URL cleanup. With the default URL import, manage the worker and URL lifetime yourself. Set `blobWorkers: false` for emitted worker files, workers with emitted assets, or Node workers. Module workers, nested workers and worker dependency rebuilds are supported. The optional worker-pool client adds queued RPC calls, transfers, timeouts and cancellation.

`bundleHTML: true` creates a portable HTML file containing scripts, styles, workers, WebAssembly and imported file assets. It can be opened from disk and used as a native entry page. Normal JavaScript output keeps its configured worker/file mode. Declare runtime-fetched assets with `runtimeAssets` so they can be embedded too; computed URLs and external module imports require application handling.

Multiple entries each receive their own HTML file with the matching styles, including hashed filenames. File/copy loaders in `workerBundler.loader` are embedded too. External imports and plugins that leave companion assets fail the portable build with an explanation. Server APIs, browser permissions and features needing cross-origin isolation still require a suitable server.

See [webworkers](../../examples/webworkers/README.md), [worker_files](../../examples/worker_files/README.md), [node_worker](../../examples/node_worker/README.md), [nested_workers](../../examples/nested_workers/README.md), [worker_pool](../../examples/worker_pool/README.md) and [html_bundle](../../examples/html_bundle/README.md).
