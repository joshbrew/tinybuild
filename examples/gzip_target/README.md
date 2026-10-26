# Gzip download target

Run `npm start` here after installing dependencies in the repository root. Tinybuild builds a portable HTML page and maximum-compression `.gz` copies of the built text files. This example uses production settings, so it does not watch saved edits.

Open the shown URL. The app works normally; the browser automatically unpacks compressed responses. In browser developer tools, open Network and inspect the page response: `Content-Encoding: gzip` means the smaller copy was sent. Its content type is still HTML.

`npm run build` builds without serving. `npm run serve` serves that existing output. You can also open `dist/index.html` directly from disk; keep the original files when deploying.

The server picks the original when gzip is unavailable, stale, larger than the original, or excluded by the browser. Range requests use the original when allowed. Set `server.precompressed: false` to turn compressed serving off. Development HTML with injected live-reload code always uses the original page.

`bundleGzip` compresses emitted scripts, styles, workers, WebAssembly, text assets, source maps and portable HTML. It does not compress your whole project or modify API/proxy responses. The full commented config reference is included for customization.
