import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture } from "./helpers.js";
import { loadConfig } from "../tinybuild/config.js";
import { packager } from "../tinybuild/packager.js";
import { bundle, normalizeBuildOptions } from "../tinybuild/esbuild/bundler.js";

test("Node targets leave native packages to Node unless package bundling is explicitly requested", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "import binding from 'native-package';console.log(binding);",
    "node_modules/native-package/package.json":
      '{"name":"native-package","main":"index.cjs"}',
    "node_modules/native-package/index.cjs":
      "module.exports=require('./binding.node');",
    "node_modules/native-package/binding.node": Buffer.from([1, 2, 3]),
  });
  const options = {
    absWorkingDir: cwd,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    bundleNode: true,
    autoInstall: false,
  };
  const results = await bundle(options);
  assert.ok(
    Object.values(results[0].node.metafile.outputs).some((output) =>
      output.imports.some(
        (item) => item.path === "native-package" && item.external,
      ),
    ),
  );
  assert.equal(
    normalizeBuildOptions({ ...options, packages: "bundle" }, "node").packages,
    "bundle",
  );
  await assert.rejects(
    bundle({ ...options, entryPoints: ["missing.ts"], logLevel: "silent" }),
    /Could not resolve.*missing\.ts/,
  );
  for (const entryPoints of [
    { backend: "missing.ts" },
    [{ in: "missing.ts", out: "backend" }],
  ])
    await assert.rejects(
      bundle({ ...options, entryPoints, logLevel: "silent" }),
      /Could not resolve.*missing\.ts/,
    );
});

test("declaration generation accepts existing Node module-resolution settings with TypeScript 6", async (t) => {
  const cwd = await fixture(t, {
    "index.ts": "export const answer: number = 42;",
    "tsconfig.json": JSON.stringify({
      include: ["index.ts"],
      compilerOptions: {
        target: "es2020",
        module: "es2020",
        moduleResolution: "node",
        skipLibCheck: true,
      },
    }),
  });
  const results = await bundle({
    absWorkingDir: cwd,
    entryPoints: ["index.ts"],
    outfile: "dist/index",
    bundleTypes: true,
    autoInstall: false,
  });
  assert.ok(results[0].ts.outputs.some((file) => file.text.includes("answer")));
});
import { copyStackFile, stackCases } from "../scripts/check-stacks.js";

test("real-stack fixtures cover the requested projects and exclude generated and private files", () => {
  assert.deepEqual(
    stackCases.map((item) => item.name),
    [
      "webgpujs",
      "uplot-webgpu",
      "vibe_code_experiments/noiseCompute",
      "webgl-plot-utils",
      "myalyce_dev",
      "autogpt_web_dev_server",
      "banglejs_server_test",
    ],
  );
  for (const filename of [
    ".git/config",
    "backend/.env",
    "backend/.env.production",
    "server.key",
    "backend/dist/server.js",
    "node_modules/package/index.js",
    "android/app/Main.java",
  ])
    assert.equal(copyStackFile(filename), false, filename);
  for (const filename of [
    "index.tsx",
    "backend/tinybuild.config.js",
    "frontend/style.scss",
    "package-lock.json",
  ])
    assert.equal(copyStackFile(filename), true, filename);
});

test("CommonJS .js configs inside ESM apps build multi-entry Node backends without modifying their config", async (t) => {
  const source =
    'const config={bundler:{entryPoints:["contentserver.ts","dataserver.ts"],outdir:"dist",bundleBrowser:false,bundleNode:true,minifyWhitespace:true},server:false};module.exports=config;';
  const cwd = await fixture(t, {
    "package.json": '{"type":"module"}',
    "tinybuild.config.js": source,
    "contentserver.ts": "export const content: string='content';",
    "dataserver.ts": "export const data: number=42;",
  });
  const config = await loadConfig("tinybuild.config.js", cwd, true);
  const app = await packager({ ...config, build: true }, { cwd });
  await app.close();
  assert.equal(
    app.bundles[0].node.metafile.outputs["dist/dataserver.js"].entryPoint,
    "dataserver.ts",
  );
  assert.equal(
    await fs.readFile(path.join(cwd, "tinybuild.config.js"), "utf8"),
    source,
  );
  assert.ok(!(await fs.readdir(cwd)).some((file) => file.endsWith(".cjs")));
});

test("stack-shaped Sass plugins, JSX loaders and multi-entry browser configs remain usable", async (t) => {
  const cwd = await fixture(t, {
    "package.json": '{"type":"module"}',
    "tinybuild.config.js": `import plugin from './sass-plugin.js';export default {bundler:{entryPoints:['index.jsx','tools/panel.js'],outdir:'dist',bundleBrowser:true,minifyWhitespace:true,loader:{'.js':'jsx'},plugins:[plugin]},server:{hotreload:5000,ignore:['tools'],delay:50}};`,
    "sass-plugin.js": `export default {name:'sass',setup(build){build.onLoad({filter:/\\.scss$/},()=>({contents:'body{color:green}',loader:'css'}));}};`,
    "index.jsx": `import './style.scss';const React={createElement:()=>42};console.log(<div/>);`,
    "style.scss": "$color:green;body{color:$color}",
    "tools/panel.js": "console.log('panel');",
  });
  const config = await loadConfig("tinybuild.config.js", cwd, true);
  const app = await packager(
    { ...config, build: true, server: false },
    { cwd },
  );
  await app.close();
  assert.ok(app.bundles[0].browser.metafile.outputs["dist/index.css"]);
  assert.ok(app.bundles[0].browser.metafile.outputs["dist/tools/panel.js"]);
});
