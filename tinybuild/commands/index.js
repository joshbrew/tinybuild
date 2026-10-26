import { json, list } from "./utils.js";
// This registry also drives CLI help. Nested init scripts use config JSON.
const options = (names) =>
  Object.fromEntries(names.split(" ").map((name) => [name, json]));
export const basic = options(
  "remote dev status url envFile start build bundle serve init help doctor report devices analyze benchmark baseline lan qr profile path cfgpath config configure set yes GLOBAL changed mode dir entry core includeCore script assets mobile device connection electron tauri desktop devtools inspect production frozen stats native budgets tasks preview validate strict clean dryRun copy diagnostics strictConfig metadata json check stage options search example list agentGuide doctorTarget worker typescript workerRuntime",
);
Object.assign(basic, { assets: list });
export const bundler = options(
  "bundleBrowser bundleESM bundleTypes bundleNode bundleHTML bundleGzip bundleCommonJS bundleIIFE includeDefaultPlugins outfile outdir platform globalThis globals minify minifyWhitespace minifySyntax minifyIdentifiers sourcemap outputs blobWorkers workerBundler workerType runtimeAssets hotSwap autoInstall remoteImports target format splitting publicPath",
);
Object.assign(bundler, { entryPoints: list, external: list });
export const server = options(
  "debug socket_protocol pwa hotreload delay redirect reloadscripts keypath certpath python python_node host port portRetries open cacheControl responseTimeout protocol startpage root staticRoots readinessPath shutdownTimeout requestTimeout headers spa proxy precompressed",
);
Object.assign(server, {
  watch: list,
  ignore: list,
  extensions: list,
  hotreloadExtensions: list,
});
// Paths and labels stay strings even when they look like JSON scalars.
for (const group of [basic, bundler, server]) {
  for (const name of "remote url path cfgpath GLOBAL changed mode dir script outfile outdir platform globalThis socket_protocol redirect keypath certpath host protocol startpage root readinessPath format publicPath profile workerType device connection desktop search example doctorTarget worker workerRuntime".split(
    " ",
  )) {
    if (Object.hasOwn(group, name))
      group[name] = (value) => {
        if (value === true) throw new Error(name + " requires a value");
        return String(value);
      };
  }
}
export const booleanOptions = new Set(
  "dev status open start build bundle serve init help doctor report devices analyze lan qr production frozen stats core includeCore bundleBrowser bundleESM bundleTypes bundleNode bundleHTML bundleGzip bundleCommonJS bundleIIFE includeDefaultPlugins blobWorkers autoInstall minify minifyWhitespace minifySyntax minifyIdentifiers splitting debug reloadscripts precompressed electron tauri preview validate strict clean dryRun strictConfig yes configure devtools json check stage options list agentGuide typescript".split(
    " ",
  ),
);
