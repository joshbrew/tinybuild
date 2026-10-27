import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixture, request } from "./helpers.js";
import { recordOutputs, cleanGenerated } from "../tinybuild/outputs.js";
import { serve } from "../tinybuild/node_server/server.js";
import { addHotReloadClient } from "../tinybuild/node_server/hotreload/hotreload.js";
import {
  bundle,
  bundleTypes,
  createBuildContexts,
} from "../tinybuild/esbuild/bundler.js";

test("one-shot and incremental config groups consume newly generated inputs in config order", async (t) => {
  const cwd = await fixture(t, {
    "library.js": 'export const value = "first";',
    "app.js":
      'import {value} from "./generated/library.js";globalThis.result=value;',
  });
  let expected = "first";
  const configs = [
    {
      absWorkingDir: cwd,
      entryPoints: ["library.js"],
      outfile: "generated/library.js",
      format: "esm",
      bundleBrowser: true,
      bundleTypes: true,
      autoInstall: false,
      plugins: [
        {
          name: "delayed-library",
          setup(build) {
            build.onStart(
              () => new Promise((resolve) => setTimeout(resolve, 30)),
            );
          },
        },
      ],
    },
    {
      absWorkingDir: cwd,
      entryPoints: ["app.js"],
      outfile: "dist/app.js",
      autoInstall: false,
      plugins: [
        {
          name: "generated-types",
          setup(build) {
            build.onStart(async () => {
              assert.match(
                await fs.readFile(
                  path.join(cwd, "generated/library.d.ts"),
                  "utf8",
                ),
                new RegExp(expected),
              );
            });
          },
        },
      ],
    },
  ];
  await bundle(configs);
  assert.match(
    await fs.readFile(path.join(cwd, "dist/app.js"), "utf8"),
    /first/,
  );
  await fs.writeFile(
    path.join(cwd, "library.js"),
    'export const value = "second";',
  );
  expected = "second";
  await bundle(configs);
  assert.match(
    await fs.readFile(path.join(cwd, "dist/app.js"), "utf8"),
    /second/,
  );
  const contexts = await createBuildContexts(configs);
  try {
    await fs.writeFile(
      path.join(cwd, "library.js"),
      'export const value = "third";',
    );
    expected = "third";
    await contexts.rebuild();
    assert.match(
      await fs.readFile(path.join(cwd, "dist/app.js"), "utf8"),
      /third/,
    );
  } finally {
    await contexts.dispose();
  }
});

test("incremental build groups keep separate results when a config object is reused", async (t) => {
  const cwd = await fixture(t, { "index.js": "console.log(42);" });
  const config = {
    absWorkingDir: cwd,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    autoInstall: false,
  };
  const contexts = await createBuildContexts([config, config]);
  try {
    const groups = await contexts.rebuild();
    assert.equal(groups.length, 2);
    assert.ok(groups.every((group) => group.browser?.metafile));
  } finally {
    await contexts.dispose();
  }
});

test("unchanged manifests avoid writes but content, kind and removed-file changes stay current", async (t) => {
  const cwd = await fixture(t, { "dist/a.js": "first", "dist/b.js": "second" });
  const manifest = path.join(cwd, ".tinybuild/outputs.json");
  await recordOutputs(["dist/a.js", "dist/a.js", "dist/b.js"], { cwd });
  assert.equal(JSON.parse(await fs.readFile(manifest, "utf8")).files.length, 2);
  const sentinel = new Date("2000-01-01T00:00:00Z");
  await fs.utimes(manifest, sentinel, sentinel);
  await recordOutputs(["dist/a.js", "dist/b.js"], { cwd });
  await cleanGenerated({ cwd, kind: "copy" });
  assert.equal((await fs.stat(manifest)).mtimeMs, sentinel.getTime());
  await fs.writeFile(path.join(cwd, "dist/a.js"), "changed");
  await recordOutputs(["dist/a.js"], { cwd, kind: "copy" });
  assert.notEqual((await fs.stat(manifest)).mtimeMs, sentinel.getTime());
  const result = await cleanGenerated({ cwd, kind: "copy" });
  assert.deepEqual(result.removed, ["dist/a.js"]);
  assert.deepEqual(
    JSON.parse(await fs.readFile(manifest, "utf8")).files.map(
      (file) => file.path,
    ),
    ["dist/b.js"],
  );
  await fs.writeFile(path.join(cwd, "dist/b.js"), "user edit");
  await fs.utimes(manifest, sentinel, sentinel);
  assert.deepEqual((await cleanGenerated({ cwd })).preserved, ["dist/b.js"]);
  assert.equal((await fs.stat(manifest)).mtimeMs, sentinel.getTime());
});

test("copy cleanup skips unrelated output stats but full cleanup freshly rejects escaping junctions", async (t) => {
  const cwd = await fixture(t, {
    "dist/build/a.js": "build",
    "dist/copy.txt": "copy",
  });
  const outside = await fixture(t, { "a.js": "outside" });
  await recordOutputs(["dist/build/a.js"], { cwd });
  await recordOutputs(["dist/copy.txt"], { cwd, kind: "copy" });
  await fs.unlink(path.join(cwd, "dist/build/a.js"));
  await fs.rmdir(path.join(cwd, "dist/build"));
  await fs.symlink(outside, path.join(cwd, "dist/build"), "junction");
  const seen = [];
  const realpath = fs.realpath;
  t.mock.method(fs, "realpath", (filename, ...args) => {
    seen.push(path.resolve(filename));
    return realpath(filename, ...args);
  });
  assert.deepEqual((await cleanGenerated({ cwd, kind: "copy" })).removed, [
    "dist/copy.txt",
  ]);
  assert.equal(seen.includes(path.join(cwd, "dist/build/a.js")), false);
  await assert.rejects(cleanGenerated({ cwd }), /escapes project/);
  assert.equal(
    await fs.readFile(path.join(outside, "a.js"), "utf8"),
    "outside",
  );
  // Remove just the link before the fixture helper recursively cleans its root.
  await fs.unlink(path.join(cwd, "dist/build"));
});

test("scoped cleanup still validates every manifest path before deleting any selected file", async (t) => {
  const cwd = await fixture(t, { "dist/copy.txt": "copy" });
  await recordOutputs(["dist/copy.txt"], { cwd, kind: "copy" });
  const filename = path.join(cwd, ".tinybuild/outputs.json");
  const manifest = JSON.parse(await fs.readFile(filename, "utf8"));
  manifest.files.push({
    path: "../outside",
    hash: "0".repeat(64),
    kind: "build",
  });
  await fs.writeFile(filename, JSON.stringify(manifest));
  await assert.rejects(cleanGenerated({ cwd, kind: "copy" }), /Unsafe/);
  assert.equal(
    await fs.readFile(path.join(cwd, "dist/copy.txt"), "utf8"),
    "copy",
  );
});

test("development HEAD reads no HTML body and GET retains fresh Unicode content and exact lengths", async (t) => {
  const cwd = await fixture(t, { "index.html": "<h1>🌌 café</h1>" });
  const app = await serve({
    cwd,
    root: ".",
    port: 0,
    host: "127.0.0.1",
    hotreload: true,
    hotreloadTransport: "sse",
  });
  t.after(() => app.close());
  const filename = path.join(cwd, "index.html");
  const reads = [];
  const readFile = fs.readFile;
  t.mock.method(fs, "readFile", (name, ...args) => {
    reads.push(path.resolve(name));
    return readFile(name, ...args);
  });
  for (const source of ["<h1>🌌 café</h1>", "<h1>Updated ✨</h1>"]) {
    await fs.writeFile(filename, source);
    const before = reads.length;
    const head = await request(app.SERVER, "/", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal(reads.length, before);
    const response = await request(app.SERVER);
    assert.equal(response.status, 200);
    assert.equal(
      response.body,
      addHotReloadClient(source, "/hotreload", "sse"),
    );
    assert.equal(Number(head.headers["content-length"]), response.bytes.length);
    assert.equal(
      Number(response.headers["content-length"]),
      response.bytes.length,
    );
    assert.equal(response.headers["cache-control"], "no-store");
  }
});

for (const [version, compiler] of [
  [5, "typescript5"],
  [6, "typescript"],
]) {
  test(`TypeScript ${version} single-pass emit reports option, syntax and declaration errors without replacing output`, async (t) => {
    const cwd = await fixture(t, {
      "main.ts": "export const answer = 42;",
      "node_modules/.keep": "",
    });
    await fs.symlink(
      fileURLToPath(new URL(`../node_modules/${compiler}`, import.meta.url)),
      path.join(cwd, "node_modules/typescript"),
      "junction",
    );
    const config = {
      absWorkingDir: cwd,
      entryPoints: ["main.ts"],
      outdir: "dist",
    };
    const [good] = (await bundleTypes(config)).outputs;
    for (const [source, options, expected] of [
      ["export const = ;", {}, /expected/i],
      ['export const answer: number = "wrong";', {}, /not assignable/],
      [
        "export const answer = 42;",
        { module: "NodeNext", moduleResolution: "Bundler" },
        /moduleResolution.*NodeNext/i,
      ],
      [
        'import {value} from "./hidden"; export const answer = value;',
        {},
        /private or protected/,
      ],
    ]) {
      await fs.writeFile(path.join(cwd, "main.ts"), source);
      await fs.writeFile(
        path.join(cwd, "hidden.ts"),
        "class Hidden { private value = 1; } export const value = new Hidden();",
      );
      await fs.writeFile(
        path.join(cwd, "tsconfig.json"),
        JSON.stringify({ files: ["main.ts"], compilerOptions: options }),
      );
      await assert.rejects(
        bundleTypes(config),
        expected,
        source + JSON.stringify(options),
      );
      assert.equal(await fs.readFile(good.path, "utf8"), good.text);
    }
    await fs.writeFile(path.join(cwd, "main.ts"), "export const answer = 84;");
    await fs.writeFile(
      path.join(cwd, "tsconfig.json"),
      JSON.stringify({ files: ["main.ts"] }),
    );
    assert.ok(
      (await bundleTypes(config)).outputs.some((output) =>
        output.text.includes("84"),
      ),
    );
  });
}

test("TypeScript 7 emits large nested declaration/map sets with stable paths in writing and preview builds", async (t) => {
  const sources = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `src/${index % 2 ? "nested/" : ""}part${index}.ts`,
      `export const value${index} = ${index};`,
    ]),
  );
  const cwd = await fixture(t, {
    ...sources,
    "tsconfig.json": JSON.stringify({
      include: ["src"],
      compilerOptions: { rootDir: "src", declarationMap: true },
    }),
    "node_modules/.keep": "",
  });
  await fs.symlink(
    fileURLToPath(new URL("../node_modules/typescript7", import.meta.url)),
    path.join(cwd, "node_modules/typescript"),
    "junction",
  );
  const config = { absWorkingDir: cwd, outdir: "dist" };
  const preview = await bundleTypes({ ...config, write: false });
  assert.equal(preview.outputs.length, 80);
  await assert.rejects(fs.access(path.join(cwd, "dist")), { code: "ENOENT" });
  const written = await bundleTypes(config);
  assert.deepEqual(written.outputs, preview.outputs);
  for (const output of written.outputs) {
    assert.equal(await fs.readFile(output.path, "utf8"), output.text);
    if (output.path.endsWith(".map")) {
      const map = JSON.parse(output.text);
      await fs.access(path.resolve(path.dirname(output.path), map.sources[0]));
    }
  }
});
