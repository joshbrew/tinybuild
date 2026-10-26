# Nested workers

Run npm start to use emitted module workers. Run npm run build and open dist/index.html directly to use the embedded variant, including its nested worker and JSON settings. The explicit tinybuild:asset/settings import produces a data URL in both variants. Worker factories terminate their child workers and release blob URLs after the last managed worker terminates.

The page imports `./outer.Worker`, which resolves `outer.Worker.js`; that worker imports `./leaf.worker`, which resolves `leaf.worker.js`. Both suffix spellings work without the final JavaScript/TypeScript extension, including inside other workers. Match the file's letter case for Linux builds.
