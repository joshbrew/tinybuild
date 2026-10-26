# TypeScript page with live reload

## Run

```sh
npm install
npm start
```

Follow the printed URL. Stop development with Ctrl+C.

## Try it

Use the same page workflow with TypeScript and editor type checking.

Edit `index.ts` or `index.css` and save. Run `npm run typecheck` to check types without writing JavaScript.

`npm run typecheck` checks the source using the same commented `tsconfig.json` and `tinybuild-env.d.ts` shipped by the scaffold. The declaration file explains CSS imports to TypeScript; add declarations there for other imported assets. The config uses bundler-style import lookup and leaves JavaScript output to esbuild. Its comments show React and Node variations. `bundleTypes: true` in tinybuild.config.js enables declaration output independently of the type checker's `noEmit` setting.

Run `npm run check` to verify the build when needed. The complete `tinybuild.config.js` explains all settings. [Agent guide](node_modules/tinybuild/tinybuild/docs/agents.md).
