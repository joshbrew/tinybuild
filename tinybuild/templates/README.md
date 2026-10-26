# Your tinybuild app

```sh
npm install
npm start
```

Follow the printed URL. Edit `index.js`, `index.css` or `index.html` and save to see the page update. Stop development with Ctrl+C.

| I want to…                    | Run                                     |
| ----------------------------- | --------------------------------------- |
| Build once                    | `npm run build`                         |
| Serve files I already built   | `npm run serve`                         |
| Check the build               | `npm run check`                         |
| Choose settings with guidance | `npx tinybuild config`                  |
| Explain a setting             | `npx tinybuild options --search worker` |
| Check my tools                | `npm run doctor`                        |

`tinybuild.config.js` contains the complete commented settings reference. Start with the entry file, output path and server port. Leave optional settings commented until you need them.

For TypeScript, use a `.ts` entry file and install TypeScript. The TypeScript starter includes `tsconfig.json` for browser, React and Node options, plus `tinybuild-env.d.ts` for stylesheet imports. `bundleTypes` builds declarations separately.
