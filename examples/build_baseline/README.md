# Catch unexpected build growth

```sh
npm run build
```

Open `dist/report.html`. Select an output to see which source imports contribute to it. The report works as a standalone file without a server or external libraries.

A **baseline** is a saved set of output sizes. This example measures raw, gzip and Brotli sizes, then compares raw-byte growth with `tinybuild.baseline.json`. A **budget** is the allowed size or growth in bytes.

After reviewing an intentional size change, run `npm run baseline` to build and update the saved measurements. Commit that baseline with the source change so others can review it. Updating a baseline does not launch native SDK tasks. Cleanup removes generated reports while keeping the baseline.
