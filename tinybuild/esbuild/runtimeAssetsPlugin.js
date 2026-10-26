import fs from "node:fs/promises";
import path from "node:path";

// Explicit assets are data URLs in every target, so worker fetches also work
// when the script itself is a blob or the application is a standalone HTML file.
export function runtimeAssetsPlugin(assets = {}) {
  return {
    name: "tinybuild-runtime-assets",
    setup(build) {
      const cwd = build.initialOptions.absWorkingDir || process.cwd();
      const files = new Set(
        Object.values(assets).map((filename) => path.resolve(cwd, filename)),
      );
      build.onResolve({ filter: /^tinybuild:asset\// }, (args) => {
        const name = args.path.slice("tinybuild:asset/".length);
        if (!Object.hasOwn(assets, name))
          return { errors: [{ text: "Unknown runtime asset: " + name }] };
        return { path: path.resolve(cwd, assets[name]) };
      });
      build.onLoad({ filter: /.*/, namespace: "file" }, async (args) => {
        if (!files.has(args.path)) return;
        return {
          contents: await fs.readFile(args.path),
          loader: "dataurl",
          watchFiles: [args.path],
        };
      });
    },
  };
}
