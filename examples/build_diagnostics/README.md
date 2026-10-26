# Find large files and slow builds

```sh
npm run analyze
npm run benchmark
```

`analyze` lists built files, their sizes and the imports contributing to them. `benchmark` compares three new build contexts with three incremental rebuilds; OS and package caches stay warm.

A **budget** is a size limit in bytes. Lower one in `tinybuild.config.js` and build again to see the file and limit reported. Use this to catch an unexpectedly large import. Development stats also list which source files triggered a build.
