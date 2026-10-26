import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { Worker } from "node:worker_threads";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { bundle } from "../tinybuild/esbuild/bundler.js";
import {
  createStreamingImportsPlugin,
  httpGet,
} from "../tinybuild/esbuild/streamingImportsPlugin.js";
import {
  createInstallerPlugin,
  packageName,
} from "../tinybuild/esbuild/installerPlugin.js";
import { fixture, listening } from "./helpers.js";

for (const blobs of [true, false])
  test(
    "workers honor blobWorkers=" + blobs + " without a config file",
    async (t) => {
      const root = await fixture(t, {
        "index.js": 'import url from "./task.worker.js"; console.log(url);',
        "task.worker.js":
          'import {value} from "./shared.js"; self.postMessage(value);',
        "shared.js": "export const value=42;",
      });
      const result = await bundle({
        absWorkingDir: root,
        entryPoints: ["index.js"],
        outfile: "dist/index",
        blobWorkers: blobs,
        autoInstall: false,
      });
      const code = await fs.readFile(path.join(root, "dist/index.js"), "utf8");
      assert.equal(code.includes("createObjectURL"), blobs);
      const files = await fs.readdir(path.join(root, "dist"));
      assert.equal(
        files.some((file) => file.startsWith("task.worker-")),
        !blobs,
      );
      assert.ok(
        Object.keys(result[0].browser.metafile.inputs).some((file) =>
          file.endsWith("shared.js"),
        ),
      );
    },
  );
test("workers with identical basenames emit distinct paths", async (t) => {
  const root = await fixture(t, {
    "index.js":
      'import a from "./a/task.worker.js"; import b from "./b/task.worker.js"; console.log(a,b);',
    "a/task.worker.js": 'self.postMessage("a");',
    "b/task.worker.js": 'self.postMessage("b");',
  });
  await bundle({
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outdir: "dist",
    blobWorkers: false,
    autoInstall: false,
  });
  assert.equal(
    (await fs.readdir(path.join(root, "dist"))).filter((file) =>
      file.startsWith("task.worker-"),
    ).length,
    2,
  );
});
test("worker failures reject instead of falling back to raw source", async (t) => {
  const root = await fixture(t, {
    "index.js": 'import url from "./bad.worker.js"; console.log(url);',
    "bad.worker.js": "this is invalid javascript !",
  });
  await assert.rejects(
    bundle({
      absWorkingDir: root,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
      logLevel: "silent",
    }),
    /Build failed/,
  );
});
test("nested worker diagnostics honor parent silence and explicit worker logging", async (t) => {
  const root = await fixture(t, {
    "index.js": 'import url from "./outer.worker.js";console.log(url);',
    "outer.worker.js": 'import url from "./inner.worker.js";new Worker(url);',
    "inner.worker.js": "export const = ;",
  });
  for (const [parent, worker, printed] of [
    ["silent", undefined, false],
    ["silent", "error", true],
    ["error", "silent", true],
    [undefined, undefined, true],
  ]) {
    const config = {
      absWorkingDir: root,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
      logLevel: parent,
      workerBundler: worker ? { logLevel: worker } : undefined,
    };
    const source = `import {bundle} from ${JSON.stringify(new URL("../tinybuild/esbuild/bundler.js", import.meta.url).href)};try{await bundle(${JSON.stringify(config)})}catch(error){console.log(JSON.stringify({message:error.message}));process.exitCode=1}`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", source],
      { cwd: root, windowsHide: true, encoding: "utf8", timeout: 5000 },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(JSON.parse(result.stdout).message, /Expected identifier/);
    if (printed) assert.match(result.stderr, /Expected identifier/);
    else assert.equal(result.stderr, "");
  }
});

test("Node workers receive usable runtime paths", async (t) => {
  const root = await fixture(t, {
    "package.json": '{"type":"module"}',
    "index.js": 'export {default as url} from "./task.worker.js";',
    "task.worker.js":
      'import {parentPort} from "node:worker_threads"; parentPort.postMessage(42);',
  });
  await bundle({
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    bundleNode: true,
    blobWorkers: false,
    autoInstall: false,
  });
  const { url } = await import(
    pathToFileURL(path.join(root, "dist/index.js")).href
  );
  const worker = new Worker(url);
  t.after(() => worker.terminate());
  const [message] = await once(worker, "message");
  assert.equal(message, 42);
});
test("remote modules resolve cycles, reexports, queries, redirects, CSS, and distinct basenames", async (t) => {
  const root = await fixture(t);
  const routes = {
    "/a/index.js?v=1": 'export {value} from "./child.js"; export const a=1;',
    "/a/child.js":
      'import {b} from "../b/index.js?v=2"; export const value=b+1;',
    "/b/index.js?v=2": "export const b=40;",
    "/redirect": null,
    "/styles.css": "body{color:red}",
  };
  let hits = 0;
  const server = await listening(
    http
      .createServer((req, res) => {
        hits++;
        if (req.url === "/redirect") {
          res.writeHead(302, { Location: "/a/index.js?v=1" });
          return res.end();
        }
        if (!(req.url in routes)) {
          res.writeHead(404);
          return res.end("missing");
        }
        res.end(routes[req.url]);
      })
      .listen(0, "127.0.0.1"),
  );
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  const options = {
    absWorkingDir: root,
    stdin: {
      contents:
        'import {value} from "' + base + '/redirect"; console.log(value);',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    plugins: [createStreamingImportsPlugin()],
  };
  const output = await esbuild.build(options);
  assert.match(output.outputFiles[0].text, /40/);
  const cachedHits = hits;
  await esbuild.build({
    ...options,
    plugins: [createStreamingImportsPlugin({ frozen: true })],
  });
  assert.equal(hits, cachedHits);
  await assert.rejects(
    esbuild.build({
      ...options,
      stdin: { contents: 'import "' + base + '/uncached.js";' },
      logLevel: "silent",
      plugins: [createStreamingImportsPlugin({ frozen: true })],
    }),
    /frozen/,
  );
  const css = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [base + "/styles.css"],
    outfile: "style.css",
    bundle: true,
    write: false,
    plugins: [createStreamingImportsPlugin()],
  });
  assert.match(css.outputFiles[0].text, /color: red/);
});
test("remote request errors, redirect loops, limits, and timeout reject", async (t) => {
  const server = await listening(
    http
      .createServer((req, res) => {
        if (req.url === "/loop") {
          res.writeHead(302, { Location: "/loop" });
          res.end();
        } else if (req.url === "/big") res.end("a".repeat(100));
        else if (req.url === "/slow") setTimeout(() => res.end("late"), 100);
        else {
          res.writeHead(404);
          res.end();
        }
      })
      .listen(0, "127.0.0.1"),
  );
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  await assert.rejects(httpGet(base + "/missing"), /404/);
  await assert.rejects(httpGet(base + "/loop", { redirects: 1 }), /redirects/);
  await assert.rejects(
    httpGet(base + "/big", { maxBytes: 10 }),
    /maximum size/,
  );
  await assert.rejects(httpGet(base + "/slow", { timeout: 10 }), /timed out/);
});
test("installer distinguishes packages, built-ins, URLs, and shell text", () => {
  assert.equal(packageName("@scope/pkg/subpath"), "@scope/pkg");
  assert.equal(packageName("pkg/subpath"), "pkg");
  for (const name of [
    "fs",
    "node:fs",
    "./local.js",
    "https://example.test",
    "bad;echo",
    "../a",
  ])
    assert.equal(packageName(name), null);
});

test("installer leaves transitive and optional native bindings to the package manager", async (t) => {
  const root = await fixture(t, {
    "index.js": "import value from 'native-package';console.log(value);",
    "node_modules/native-package/package.json": '{"main":"index.js"}',
    "node_modules/native-package/index.js":
      "try { require('binding-for-another-os'); } catch {} export default 42;",
  });
  let installations = 0;
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ["index.js"],
    bundle: true,
    write: false,
    plugins: [
      createInstallerPlugin({
        install: async () => {
          installations++;
        },
      }),
    ],
  });
  assert.match(result.outputFiles[0].text, /42/);
  assert.equal(installations, 0);
});
test("installer deduplicates requests, honors packageManager, and never imports module code", async (t) => {
  const root = await fixture(t, {
    "package.json": '{"packageManager":"pnpm@10.0.0"}',
  });
  let resolve,
    installations = 0,
    installed = false;
  const plugin = createInstallerPlugin({
    install: async (args, options) => {
      installations++;
      assert.deepEqual(args, ["add", "fixture-package"]);
      assert.equal(options.manager, "pnpm");
      await fs.mkdir(path.join(root, "node_modules/fixture-package"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(root, "node_modules/fixture-package/package.json"),
        "{}",
      );
      installed = true;
    },
  });
  plugin.setup({
    initialOptions: { absWorkingDir: root },
    onResolve: (filter, callback) => {
      resolve = callback;
    },
    resolve: async () =>
      installed
        ? { path: "/resolved.js", errors: [] }
        : { errors: [{ text: "missing" }] },
  });
  const args = {
    path: "fixture-package",
    namespace: "file",
    resolveDir: root,
    kind: "import-statement",
  };
  await Promise.all([resolve(args), resolve(args)]);
  assert.equal(installations, 1);
  installed = false;
  assert.equal(
    await resolve({ ...args, path: "fixture-package/missing" }),
    undefined,
  );
});

test("a failed parent build preserves existing emitted worker files", async (t) => {
  const root = await fixture(t, {
    "index.js": 'import url from "./task.worker.js"; console.log(url);',
    "task.worker.js": "self.postMessage(1);",
  });
  const config = {
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    blobWorkers: false,
    autoInstall: false,
    logLevel: "silent",
  };
  await bundle(config);
  const filename = (await fs.readdir(path.join(root, "dist"))).find((file) =>
    file.startsWith("task.worker-"),
  );
  const original = await fs.readFile(path.join(root, "dist", filename), "utf8");
  await fs.writeFile(path.join(root, "task.worker.js"), "self.postMessage(2);");
  await fs.writeFile(
    path.join(root, "index.js"),
    'import url from "./task.worker.js"; import missing from "./missing.js"; console.log(url,missing);',
  );
  await assert.rejects(bundle(config));
  assert.equal(
    await fs.readFile(path.join(root, "dist", filename), "utf8"),
    original,
  );
});

test("installations are shared across plugin instances and serialized per project", async (t) => {
  const root = await fixture(t);
  let active = 0,
    maximum = 0,
    calls = 0;
  const installed = new Set();
  const install = async (args) => {
    calls++;
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    installed.add(args[1]);
    active--;
  };
  function resolver() {
    let callback;
    createInstallerPlugin({ install }).setup({
      initialOptions: { absWorkingDir: root },
      onResolve: (filter, fn) => {
        callback = fn;
      },
      resolve: async (specifier) =>
        installed.has(specifier)
          ? { path: specifier, errors: [] }
          : { errors: [{ text: "missing" }] },
    });
    return (name) =>
      callback({
        path: name,
        namespace: "file",
        resolveDir: root,
        kind: "import-statement",
      });
  }
  const a = resolver(),
    b = resolver();
  await Promise.all([a("fixture-a"), b("fixture-a"), b("fixture-b")]);
  assert.equal(calls, 2);
  assert.equal(maximum, 1);
});

test("Node workers run from CommonJS parent bundles without import.meta or package-type assumptions", async (t) => {
  const root = await fixture(t, {
    "package.json": '{"type":"commonjs"}',
    "index.js": 'export {default as url} from "./task.worker.js";',
    "task.worker.js":
      'import {parentPort} from "node:worker_threads";parentPort.postMessage(84);',
  });
  await bundle({
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    bundleNode: { format: "cjs" },
    blobWorkers: false,
    autoInstall: false,
  });
  const { createRequire } = await import("node:module");
  const { url } = createRequire(path.join(root, "package.json"))(
    "./dist/index.cjs",
  );
  const worker = new Worker(url);
  t.after(() => worker.terminate());
  const [message] = await once(worker, "message");
  assert.equal(message, 84);
});
