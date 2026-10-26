# Self-contained HTML with workers

Run npm run build, then double-click dist/index.html. Its worker, imported text, icon, CSS and JavaScript are embedded; no web server is needed. The normal JavaScript build still uses the configured file worker.

The `./task.worker` import resolves `task.worker.js`. You can also write the complete filename; both forms return the worker URL and support the same factory helpers.

Imported file/copy assets use data URLs in the HTML variant. Worker modules are compiled into embedded blobs. Runtime fetches, absolute remote URLs and computed new URL paths are application dependencies and cannot be made portable automatically.
