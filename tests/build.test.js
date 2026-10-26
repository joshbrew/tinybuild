import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  bundle,
  normalizeBuildOptions,
  createBuildContexts,
  bundleTypes,
} from "../tinybuild/esbuild/bundler.js";
import {
  hotBundle,
  disposeHotBundles,
} from "../tinybuild/esbuild/hotswap/hotswapBundler.js";
import { fixture, until } from "./helpers.js";
import { runTinybuild } from "../tinybuild/cli.js";

const base = (root) => ({
  absWorkingDir: root,
  entryPoints: ["index.js"],
  outfile: "dist/index",
  autoInstall: false,
});
test("multi-target builds return results and isolate target options", async (t) => {
  const root = await fixture(t, {
    "index.js":
      'export const value = typeof FLAG === "undefined" ? "plain" : FLAG;',
    "package.json": '{"type":"module"}',
  });
  const input = {
    ...base(root),
    bundleBrowser: { define: { FLAG: '"browser"' } },
    bundleESM: true,
    bundleNode: true,
    bundleCommonJS: true,
    bundleIIFE: true,
  };
  const results = await bundle(input);
  assert.ok(results[0].browser.metafile);
  assert.match(
    await fs.readFile(path.join(root, "dist/index.js"), "utf8"),
    /browser/,
  );
  assert.doesNotMatch(
    await fs.readFile(path.join(root, "dist/index.esm.js"), "utf8"),
    /"browser"/,
  );
  for (const name of ["index.node.js", "index.cjs", "index.iife.js"])
    await fs.access(path.join(root, "dist", name));
  assert.equal(input.define, undefined);
});
test("custom loaders and plugins override defaults without mutating caller state", async (t) => {
  const root = await fixture(t, {
    "index.js": 'import x from "./page.html"; console.log(x);',
    "page.html": "<p>hello</p>",
  });
  let calls = 0;
  const loader = { ".html": "file" };
  const input = {
    ...base(root),
    loader,
    plugins: [
      {
        name: "workerloader",
        setup() {
          calls++;
        },
      },
    ],
  };
  await bundle(input);
  assert.equal(calls, 1);
  assert.deepEqual(loader, { ".html": "file" });
  assert.equal(
    normalizeBuildOptions({ includeDefaultPlugins: false }).plugins.length,
    0,
  );
});
test("outdir handles multiple entries and explicit browser format overrides", async (t) => {
  const root = await fixture(t, {
    "index.js": "export const a=1;",
    "other.js": "export const b=2;",
  });
  await bundle({
    ...base(root),
    entryPoints: ["index.js", "other.js"],
    outdir: "output",
    bundleBrowser: { format: "esm" },
  });
  assert.match(
    await fs.readFile(path.join(root, "output/index.js"), "utf8"),
    /export/,
  );
  await fs.access(path.join(root, "output/other.js"));
});
test("build errors reject, and a failing CLI exits nonzero", async (t) => {
  const root = await fixture(t, {
    "index.js": "export const = ;",
    "tinybuild.config.mjs":
      'export default {bundler:{entryPoints:["index.js"],outfile:"dist/index",autoInstall:false},server:false};',
  });
  await assert.rejects(
    bundle({ ...base(root), logLevel: "silent" }),
    /Build failed/,
  );
  const cli = fileURLToPath(
    new URL("../tinybuild/bin/global.js", import.meta.url),
  );
  const result = spawnSync(process.execPath, [cli, "build"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Build failed/);
});
test("global exports and init scripts work without creating temporary files", async (t) => {
  const root = await fixture(t, { "index.js": "export const answer=42;" });
  await bundle({
    ...base(root),
    globalThis: "example",
    globals: { "index.js": ["answer"] },
    init: {
      "index.js": "function(bundle){globalThis.initialized = bundle.answer;}",
    },
    bundleHTML: true,
  });
  const code = await fs.readFile(path.join(root, "dist/index.js"), "utf8");
  const vm = await import("node:vm");
  const context = {};
  vm.runInNewContext(code, context);
  assert.equal(context.answer, 42);
  assert.equal(context.initialized, 42);
  assert.match(
    await fs.readFile(path.join(root, "dist/index.html"), "utf8"),
    /<!doctype html>/,
  );
  await assert.rejects(fs.access(path.join(root, ".temp")));
});
test("incremental rebuild preserves CSS cascade and emitted asset paths", async (t) => {
  const root = await fixture(t, {
    "index.js": 'import "./b.css"; import "./a.css";',
    "a.css": 'body {color:blue;background:url("./pixel.png")}',
    "b.css": "body {color:red}",
    "pixel.png": "fixture image",
  });
  const contexts = await createBuildContexts(base(root));
  t.after(() => contexts.dispose());
  await contexts.rebuild();
  let css = await fs.readFile(path.join(root, "dist/index.css"), "utf8");
  assert.ok(css.indexOf("red") < css.indexOf("blue"));
  await fs.writeFile(
    path.join(root, "a.css"),
    'body {color:green;background:url("./pixel.png")}',
  );
  await contexts.rebuild();
  css = await fs.readFile(path.join(root, "dist/index.css"), "utf8");
  assert.ok(css.indexOf("red") < css.indexOf("green"));
  const image = /url\(([^)]+)\)/.exec(css)[1].replaceAll('"', "");
  await fs.access(path.resolve(root, "dist", image));
});
test("legacy hotBundle uses the original graph and can dispose contexts", async (t) => {
  const root = await fixture(t, {
    "index.js": 'import "./index.css";',
    "index.css": "body{color:red}",
  });
  t.after(disposeHotBundles);
  await hotBundle(
    { ...base(root), hotSwap: { singleChangeDelayMs: 0 } },
    "index.css",
  );
  assert.match(
    await fs.readFile(path.join(root, "dist/index.css"), "utf8"),
    /red/,
  );
});
test("declarations emit independently, report errors, and support JS entries", async (t) => {
  const root = await fixture(t, {
    "src/api.ts": "export const value: number=42;",
    "src/js-api.js": 'export const message = "hi";',
  });
  const result = await bundleTypes({
    absWorkingDir: root,
    entryPoints: ["src/api.ts"],
    outfile: "dist/api",
  });
  assert.ok(result.outputs.some((file) => file.path.endsWith(".d.ts")));
  await fs.access(path.join(root, "dist/api.d.ts"));
  const js = await bundleTypes({
    absWorkingDir: root,
    entryPoints: ["src/js-api.js"],
    outfile: "dist/js-api",
    write: false,
  });
  assert.match(js.outputs[0].text, /message/);
  await fs.writeFile(
    path.join(root, "src/api.ts"),
    'export const value: number="wrong";',
  );
  await assert.rejects(
    bundleTypes({
      absWorkingDir: root,
      entryPoints: ["src/api.ts"],
      outdir: "types",
    }),
    /not assignable/,
  );
});

test("declarations prefer the build project's compiler over tinybuild's compiler", async (t) => {
  const compiler = fileURLToPath(
    new URL("../node_modules/typescript/lib/typescript.js", import.meta.url),
  );
  const root = await fixture(t, {
    "index.ts": "export const answer:number=42;",
    "node_modules/typescript/package.json":
      '{"name":"typescript","main":"index.cjs"}',
    "node_modules/typescript/index.cjs": `const ts=require(${JSON.stringify(compiler)});module.exports={...ts,createProgram(...args){require('node:fs').writeFileSync(require('node:path').join(args[0].host.getCurrentDirectory(),'compiler-used.txt'),'project');return ts.createProgram(...args)}};`,
  });
  const result = await bundleTypes({
    absWorkingDir: root,
    entryPoints: ["index.ts"],
    outdir: "dist",
  });
  assert.equal(
    await fs.readFile(path.join(root, "compiler-used.txt"), "utf8"),
    "project",
  );
  assert.ok(result.outputs.some((output) => output.text.includes("answer")));
});

test("unsupported compilers and declaration errors make the CLI fail with useful diagnostics", async (t) => {
  for (const unsupported of [true, false]) {
    const root = await fixture(t, {
      "index.ts": unsupported
        ? "export const answer:number=42;"
        : 'export const answer:number="wrong";',
      "tinybuild.config.mjs":
        "export default {bundler:{entryPoints:['index.ts'],outfile:'dist/index',bundleBrowser:true,bundleESM:true,bundleTypes:true,autoInstall:false},server:false};",
      ...(unsupported
        ? {
            "node_modules/typescript/package.json":
              '{"name":"typescript","main":"index.cjs"}',
            "node_modules/typescript/index.cjs":
              "module.exports={version:'8.0.0',versionMajorMinor:'8.0'};",
          }
        : {}),
    });
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../tinybuild/bin/global.js", import.meta.url)),
        "build",
        "--json",
      ],
      { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true },
    );
    assert.equal(result.status, 1, result.stderr);
    const records = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(records.at(-1).ok, false);
    assert.equal(records.at(-1).command, "build");
    assert.deepEqual(
      records.filter((event) => event.type).map((event) => event.type),
      ["building", "build-error", "closed"],
    );
    const message = records.at(-1).error.message;
    if (unsupported) {
      assert.match(message, /TypeScript >=5\.6 <8; found 8\.0\.0/);
      assert.match(message, /npm install --save-dev/);
      assert.ok(!message.includes("Cannot read properties"));
    } else assert.match(message, /not assignable/);
    const human = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../tinybuild/bin/global.js", import.meta.url)),
        "build",
      ],
      { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true },
    );
    assert.equal(human.status, 1);
    assert.equal(
      (
        human.stderr.match(
          unsupported ? /bundleTypes supports/g : /not assignable/g,
        ) || []
      ).length,
      1,
    );
  }
});

test("a development declaration error is reported once and keeps the server available for recovery", async (t) => {
  let app;
  const original = console.error,
    errors = [];
  t.after(async () => {
    console.error = original;
    await app?.close();
  });
  const cwd = await fixture(t, {
    "index.ts": 'export const answer:number="wrong";',
    "index.html": "hello",
    "tinybuild.config.mjs":
      "export default {bundler:{entryPoints:['index.ts'],outfile:'dist/index',bundleBrowser:true,bundleTypes:true,autoInstall:false},server:{host:'127.0.0.1',port:0}};",
  });
  console.error = (text) => errors.push(text);
  app = await runTinybuild([], { cwd, log() {} });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not assignable/);
  assert.equal((await fetch(app.server.url + "/_tinybuild/ready")).status, 503);
  await fs.writeFile(
    path.join(cwd, "index.ts"),
    "export const answer:number=42;",
  );
  await app.rebuild(["index.ts"]);
  await until(
    async () =>
      (await fetch(app.server.url + "/_tinybuild/ready")).status === 200,
  );
  assert.equal(errors.length, 1);
});

test("CommonJS directory outputs and explicit mjs files keep executable extensions", async (t) => {
  const root = await fixture(t, {
    "package.json": '{"type":"module"}',
    "index.js": "export const value=42;",
  });
  await bundle({
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outdir: "cjs",
    bundleCommonJS: true,
    autoInstall: false,
  });
  const { createRequire } = await import("node:module");
  assert.equal(
    createRequire(path.join(root, "package.json"))("./cjs/index.cjs").value,
    42,
  );
  await bundle({
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outfile: "dist/api.mjs",
    bundleESM: true,
    autoInstall: false,
  });
  await fs.access(path.join(root, "dist/api.mjs"));
});

test("named entry maps retain their output names when applying globals", async (t) => {
  const root = await fixture(t, { "src/api.js": "export const value=42;" });
  await bundle({
    absWorkingDir: root,
    entryPoints: { library: "src/api.js" },
    outdir: "dist",
    globalThis: "Example",
    autoInstall: false,
  });
  assert.match(
    await fs.readFile(path.join(root, "dist/library.js"), "utf8"),
    /Example/,
  );
});

test("self-contained HTML embeds file workers and imported assets while normal JS keeps files", async (t) => {
  const root = await fixture(t, {
    "index.js":
      'import url from "./task.worker.js";import image from "./icon.svg";import "./style.css";new Worker(url).postMessage(image);',
    "task.worker.js":
      'import asset from "./payload.bin"; self.onmessage=()=>self.postMessage(asset);',
    "payload.bin": "binary fixture",
    "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
    "style.css": 'body{background:url("./icon.svg")}',
  });
  const [result] = await bundle({
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    blobWorkers: false,
    bundleHTML: true,
    autoInstall: false,
  });
  const normal = await fs.readFile(path.join(root, "dist/index.js"), "utf8");
  const html = await fs.readFile(result.browser.html, "utf8");
  assert.doesNotMatch(normal, /createObjectURL/);
  assert.match(html, /createObjectURL/);
  assert.match(html, /data:image\/svg\+xml/);
  assert.match(html, /data:text\/plain;charset=utf-8,binary fixture/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
});
test("build stats report each successful compilation to callers", async (t) => {
  let app;
  t.after(() => app?.close());
  const root = await fixture(t, { "index.js": "console.log(1);" });
  const events = [];
  const { packager } = await import("../tinybuild/packager.js");
  app = await packager(
    {
      bundler: {
        absWorkingDir: root,
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
      },
      server: false,
    },
    { onBuild: (stats) => events.push(stats) },
  );
  assert.equal(app.stats.builds, 1);
  assert.ok(app.stats.outputBytes > 0);
  assert.ok(app.stats.durationMs >= 0);
  await app.rebuild();
  assert.equal(events.length, 2);
  assert.equal(app.stats.builds, 2);
});
