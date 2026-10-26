# Several entry pages

Build separate scripts for a home page and an about page.

```sh
npm start
```

Follow About on the page. Each page loads its own ESM entry; `entryPoints` and `outdir` in the config define the build. Edit `index.js` or `about.js` to try each entry.
