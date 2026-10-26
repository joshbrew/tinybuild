import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, set } from "../tinybuild/commands/command.js";
import { json, uri } from "../tinybuild/commands/utils.js";
import { mergeConfig, loadConfig } from "../tinybuild/config.js";
import { checkBoilerPlate, initRepo } from "../tinybuild/repo.js";
import { getTemplate, getTemplateSync } from "../tinybuild/templates/get.js";
import { help, doctor } from "../tinybuild/cli.js";
import { fixture } from "./helpers.js";

for (const [args, expected] of [
  [["--build"], { build: true }],
  [["bundle"], { build: true }],
  [["--bundleESM=false"], { bundler: { bundleESM: false } }],
  [["--no-minify"], { bundler: { minify: false } }],
  [["entryPoints=src/main.ts"], { bundler: { entryPoints: ["src/main.ts"] } }],
  [["--watch", "src,shared"], { server: { watch: ["src", "shared"] } }],
  [['watch=["src","shared"]'], { server: { watch: ["src", "shared"] } }],
  [["--port", "8080"], { server: { port: 8080 } }],
  [
    ['config={"server":{"redirect":"https://example.test/?a=b"}}'],
    { server: { redirect: "https://example.test/?a=b" } },
  ],
  [
    ['--config={"bundler":{"minify":true}}', "--minify=false"],
    { bundler: { minify: false } },
  ],
  [["--help"], { help: true }],
  [["init"], { init: true }],
  [["--build", "--", "unused"], { build: true }],
])
  test("CLI " + args.join(" "), () =>
    assert.deepEqual(parseArgs(args), expected),
  );
test("parsing has no exit side effects; extensions remain supported", () => {
  set("customValue", (value) => value.toUpperCase());
  assert.equal(parseArgs(["customValue=hello"]).customValue, "HELLO");
  assert.throws(() => parseArgs(["--config=nope"]), /JSON object/);
  assert.throws(() => parseArgs(["--__proto__=x"]), /Invalid option/);
  assert.deepEqual(json('{"a":1}'), { a: 1 });
  assert.deepEqual(uri("%5B1%5D"), [1]);
  assert.match(help(), /blobWorkers/);
});
test("configuration merging preserves false switches and applies production defaults", () => {
  const base = {
    bundler: { minify: false },
    server: { hotreload: 5000, port: 1 },
  };
  const result = mergeConfig(base, { production: true, server: { port: 2 } });
  assert.equal(result.server.port, 2);
  assert.equal(result.server.hotreload, false);
  assert.equal(result.bundler.autoInstall, false);
  assert.equal(base.server.hotreload, 5000);
  assert.equal(mergeConfig(base, { server: false }).server, false);
});
test("ESM and CommonJS configs load from paths containing spaces and #", async (t) => {
  const root = await fixture(t, {
    "a # space/config.mjs": "export default {server:false};",
    "config.cjs": "module.exports={build:true};",
  });
  assert.equal((await loadConfig("a # space/config.mjs", root)).server, false);
  assert.equal((await loadConfig("config.cjs", root)).build, true);
  await fs.writeFile(
    path.join(root, "config.cjs"),
    "module.exports={serve:true};",
  );
  assert.equal((await loadConfig("config.cjs", root, true)).serve, true);
});
test("scaffolding never replaces existing custom source, CSS, config, package, or docs", async (t) => {
  const root = await fixture(t, {
    "src/app.js": "keep source",
    "src/app.css": "keep css",
    "tinybuild.config.js": "keep config",
    "package.json": "{}",
    "README.md": "keep docs",
  });
  const config = {
    bundler: { entryPoints: ["src/app.js"], outdir: "output" },
    server: { startpage: "pages/home.html" },
  };
  await checkBoilerPlate(config, true, root);
  await checkBoilerPlate(config, true, root);
  for (const [filename, value] of [
    ["src/app.js", "keep source"],
    ["src/app.css", "keep css"],
    ["tinybuild.config.js", "keep config"],
    ["README.md", "keep docs"],
  ])
    assert.equal(await fs.readFile(path.join(root, filename), "utf8"), value);
  assert.match(
    await fs.readFile(path.join(root, "pages/home.html"), "utf8"),
    /\.\.\/output\/app\.js/,
  );
});
test("initializer creates a nested project and declaration config for the configured entry", async (t) => {
  const root = await fixture(t);
  await initRepo(
    path.join(root, "app"),
    ["src/main.ts"],
    "export const value = 1;",
    {
      bundler: {
        entryPoints: ["src/main.ts"],
        outfile: "dist/main",
        bundleTypes: true,
      },
      server: false,
    },
  );
  assert.match(
    await fs.readFile(path.join(root, "app/tsconfig.json"), "utf8"),
    /src\/main.ts/,
  );
  assert.equal(
    await fs.readFile(path.join(root, "app/src/main.ts"), "utf8"),
    "export const value = 1;",
  );
});
test("template reads are isolated and support async reads", async () => {
  assert.equal(
    (await getTemplate("index.css")).toString(),
    getTemplateSync("index.css").toString(),
  );
  assert.equal(globalThis.__tdirname, undefined);
});
test("package import is inert and doctor returns structured checks", () => {
  const entry = fileURLToPath(new URL("../tinybuild.js", import.meta.url));
  const script =
    'const before=process.listenerCount("SIGINT");await import(' +
    JSON.stringify(new URL("../tinybuild.js", import.meta.url).href) +
    ');if(before!==process.listenerCount("SIGINT"))throw new Error("listener side effect");console.log("ok");';
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "ok");
  assert.ok(doctor().find((check) => check.name === "esbuild").ok);
});

test("custom-entry initialization persists its configured build entry", async (t) => {
  const root = await fixture(t);
  await initRepo(path.join(root, "project"), ["src/api.js"]);
  const config = await loadConfig(
    "tinybuild.config.js",
    path.join(root, "project"),
  );
  assert.deepEqual(config.bundler.entryPoints, ["src/api.js"]);
});
test("bin-only and ESM-only native dependencies are detected without executing them", async (t) => {
  const root = await fixture(t, {
    "node_modules/fixture-cli/package.json":
      '{"name":"fixture-cli","bin":"cli.js"}',
    "node_modules/fixture-cli/cli.js": 'throw new Error("must not execute");',
  });
  const { packageAvailable } = await import("../tinybuild/process.js");
  assert.equal(packageAvailable("fixture-cli", root), true);
  assert.equal(packageAvailable("missing-fixture-package", root), false);
});

test("package templating preserves caller objects and explicit package names", async (t) => {
  const root = await fixture(t);
  const { default: create } = await import("../tinybuild/create.js");
  const content = { name: "provided-name", private: true };
  create.package(path.join(root, "package.json"), content);
  assert.equal(content.name, "provided-name");
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).name,
    "provided-name",
  );
});

test("CLI preserves numeric-looking paths and accepts numeric port syntax", () => {
  assert.equal(parseArgs(["outfile=001"]).bundler.outfile, "001");
  assert.equal(parseArgs(["startpage=404"]).server.startpage, "404");
  assert.equal(parseArgs(["globalThis=false"]).bundler.globalThis, "false");
  assert.equal(parseArgs(["port=08080"]).server.port, 8080);
  assert.throws(() => parseArgs(["--cfgpath"]), /requires a value/);
});
