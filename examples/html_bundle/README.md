# Self-contained HTML with workers

Run npm run build, then double-click dist/index.html. Its worker, imported text, icon, CSS and JavaScript are embedded; no web server is needed. The normal JavaScript build still uses the configured file worker.

The `./task.worker` import resolves `task.worker.js`. You can also write the complete filename; both forms return the worker URL and support the same factory helpers.

Imported file/copy assets use data URLs in the HTML variant. Worker modules are compiled into embedded blobs. Runtime fetches, absolute remote URLs and computed new URL paths are application dependencies and cannot be made portable automatically.

For several standalone pages, use multiple `entryPoints` with an `outdir`; each entry gets an HTML file and its own embedded CSS. Hashed `entryNames` and worker-specific file loaders work too. The build messages list generated paths, sizes and timings. Test portability by copying just the HTML to another folder and opening it with networking disabled.
