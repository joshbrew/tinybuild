# TypeScript page with live reload

Use the same page workflow with TypeScript and editor type checking.

```sh
npm start
```

Edit `index.ts` or `index.css` and save. Run `npm run typecheck` to check types without writing JavaScript.

`npm run typecheck` checks the source using the same commented `tsconfig.json` and `tinybuild-env.d.ts` shipped by the scaffold. The declaration file explains CSS imports to TypeScript; add declarations there for other imported assets. The config uses bundler-style import lookup and leaves JavaScript output to esbuild. Its comments show React and Node variations. `bundleTypes: true` in tinybuild.config.js enables declaration output independently of the type checker's `noEmit` setting.
