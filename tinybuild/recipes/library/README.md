# Publish a JavaScript library

## Run

```sh
npm install
npm run build
```

Builds finish and exit; this starter does not start a server.

## Try it

Build one TypeScript source as ESM, CommonJS and type declarations.

Inspect `dist/index.esm.js`, `dist/index.cjs` and the generated declarations. Edit the exported `greet` function in `index.ts` and build again. This example does not start a web server.

`bundleTypes: true` uses your project's TypeScript compiler: 5.6–5.x, 6.x and 7.x are supported. Choose the compiler version in your project's dependencies; the tinybuild setting stays the same.

Run `npm run check` to verify the build when needed. The complete `tinybuild.config.js` explains all settings. [Agent guide](node_modules/tinybuild/tinybuild/docs/agents.md).
