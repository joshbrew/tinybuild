# Publish a JavaScript library

Build one TypeScript source as ESM, CommonJS and type declarations.

```sh
npm run build
```

Inspect `dist/index.esm.js`, `dist/index.cjs` and the generated declarations. Edit the exported `greet` function in `index.ts` and build again. This example does not start a web server.

`bundleTypes: true` uses your project's TypeScript compiler: 5.6–5.x, 6.x and 7.x are supported. Choose the compiler version in your project's dependencies; the tinybuild setting stays the same.
