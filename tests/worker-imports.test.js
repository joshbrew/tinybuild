import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { WebSocket } from "ws";
import { bundleBrowser, bundle } from "../tinybuild/esbuild/bundler.js";
import { packager } from "../tinybuild/packager.js";
import { fixture, until, request, terminalEnv } from "./helpers.js";
const execute = promisify(execFile);

for (const filename of [
  "flow.worker.js",
  "flow.Worker.ts",
  "flow.worker",
  "flow.Worker",
]) {
  test(`short worker imports resolve ${filename} and share the explicit import's URL`, async (t) => {
    const short = filename.replace(/\.(?:js|ts)$/, "");
    const cwd = await fixture(t, {
      "index.js": `import url,{createWorker} from './${short}';import explicit from './${filename}';export {url,explicit,createWorker};`,
      [filename]: filename.endsWith(".ts")
        ? "const value:number=42;postMessage(value);"
        : "postMessage(42);",
    });
    const result = await bundleBrowser({
      absWorkingDir: cwd,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      format: "cjs",
      write: false,
      autoInstall: false,
    });
    const blobs = [],
      context = {
        module: { exports: {} },
        Blob,
        URL: {
          createObjectURL(blob) {
            blobs.push(blob);
            return `blob:${blobs.length}`;
          },
        },
        Worker: class {
          constructor(url) {
            this.url = url;
          }
          terminate() {}
        },
      };
    vm.runInNewContext(result.outputFiles[0].text, context);
    const { url, explicit, createWorker } = context.module.exports;
    assert.equal(url, "blob:1");
    assert.equal(explicit, url);
    assert.equal(createWorker().url, url);
    assert.equal(
      blobs.length,
      1,
      "One worker module for both import spellings",
    );
    const messages = [];
    vm.runInNewContext(await blobs[0].text(), {
      postMessage(value) {
        messages.push(value);
      },
    });
    assert.deepEqual(messages, [42]);
    assert.ok(Object.hasOwn(result.metafile.inputs, filename));
  });
}

test("worker shorthand respects aliases, custom extension order and explicit loaders", async (t) => {
  const cwd = await fixture(t, {
    "index.js":
      'import a from "jobs.worker";import b from "./flow.worker";console.log(a,b);',
    "flow.worker.js": "postMessage('js-choice');",
    "flow.worker.ts": "const value:string='ts-choice';postMessage(value);",
    "literal.Worker": "const value:number=42;postMessage(value);",
  });
  const result = await bundleBrowser({
    absWorkingDir: cwd,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    alias: { "jobs.worker": "./literal.Worker" },
    resolveExtensions: [".js", ".ts"],
    loader: { ".Worker": "ts" },
    blobWorkers: false,
    write: false,
    autoInstall: false,
  });
  const sources = Object.keys(result.metafile.inputs);
  assert.ok(sources.includes("literal.Worker"));
  assert.ok(sources.includes("flow.worker.js"));
  assert.ok(!sources.includes("flow.worker.ts"));
  assert.equal(result.outputFiles.length, 3);
});

test("short worker imports follow TypeScript paths and do not capture similarly named modules", async (t) => {
  const cwd = await fixture(t, {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "jobs/*": ["./src/*"] } },
    }),
    "index.js":
      'import url from "jobs/flow.worker";import value from "./flow.worker.json";import {ordinary} from "./coworker.js";console.log(url,value,ordinary);',
    "src/flow.worker.ts": "postMessage(42);",
    "flow.worker.json": '{"ordinary":true}',
    "coworker.js": 'export const ordinary="plain-module";',
  });
  const result = await bundleBrowser({
    absWorkingDir: cwd,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    blobWorkers: false,
    write: false,
    autoInstall: false,
  });
  assert.equal(result.outputFiles.length, 2);
  const main = result.outputFiles.find((file) =>
    file.path.endsWith("index.js"),
  ).text;
  assert.match(main, /plain-module/);
  assert.match(main, /ordinary: true/);
  assert.ok(Object.hasOwn(result.metafile.inputs, "src/flow.worker.ts"));
});

test("nested shorthand Node workers run on both sides of the worker boundary", async (t) => {
  const cwd = await fixture(t, {
    "package.json": '{"type":"module"}',
    "index.js":
      'import {createWorker} from "./outer.Worker";const worker=createWorker();worker.once("message",value=>{console.log(value);worker.terminate();});',
    "outer.Worker.ts":
      'import {parentPort} from "node:worker_threads";import {createWorker} from "./leaf.worker";const n:number=2;const leaf=createWorker();leaf.once("message",value=>{parentPort.postMessage(value*n);leaf.terminate();});',
    "leaf.worker":
      'import {parentPort} from "node:worker_threads";parentPort.postMessage(42);',
  });
  await bundle({
    absWorkingDir: cwd,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    bundleBrowser: false,
    bundleNode: true,
    blobWorkers: false,
    autoInstall: false,
  });
  for (const color of [false, true]) {
    const result = await execute(process.execPath, ["dist/index.js"], {
      cwd,
      timeout: 5000,
      env: terminalEnv(color),
    });
    assert.equal(stripVTControlCharacters(result.stdout).trim(), "84");
    assert.equal(result.stdout.includes("\u001b["), color);
  }
});

test("shorthand worker dependencies rebuild on saved edits", async (t) => {
  let app, socket;
  t.after(async () => {
    socket?.terminate();
    await app?.close();
  });
  const cwd = await fixture(t, {
    "index.js": 'import url from "./flow.Worker";console.log(url);',
    "flow.Worker.ts": "postMessage(41);",
    "index.html": '<script src="dist/index.js"></script>',
  });
  app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
      },
      server: { host: "127.0.0.1", port: 0 },
    },
    { cwd },
  );
  socket = new WebSocket(app.server.url.replace("http:", "ws:") + "/hotreload");
  await once(socket, "open");
  const messages = [];
  socket.on("message", (data) => messages.push(JSON.parse(data)));
  await fs.writeFile(path.join(cwd, "flow.Worker.ts"), "postMessage(42);");
  await until(() => messages.some((message) => message.type === "built"));
  assert.equal(app.stats.builds, 2);
  assert.match(
    (await request(app.server.SERVER, "/dist/index.js")).body,
    /postMessage\(42\)/,
  );
});

test("missing shorthand workers report a resolution error without falling back to raw source", async (t) => {
  const cwd = await fixture(t, {
    "index.js": 'import url from "./missing.Worker";console.log(url);',
  });
  await assert.rejects(
    bundleBrowser({
      absWorkingDir: cwd,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
      logLevel: "silent",
    }),
    /Could not resolve.*missing.Worker/,
  );
});

test("external worker modules remain external instead of being compiled", async (t) => {
  const cwd = await fixture(t, {
    "index.js": 'import url from "external.Worker";console.log(url);',
  });
  const result = await bundleBrowser({
    absWorkingDir: cwd,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    format: "esm",
    external: ["external.Worker"],
    write: false,
    autoInstall: false,
  });
  assert.equal(result.outputFiles.length, 1);
  assert.match(result.outputFiles[0].text, /from "external.Worker"/);
});

test("workers can share a helper which imports the worker's own module exports", async (t) => {
  const cwd = await fixture(t, {
    "index.js": 'export {createWorker} from "./canvas.worker";',
    "canvas.worker.ts":
      'import {double} from "./helper";onmessage=({data})=>postMessage(double(data));export default self;',
    "helper.ts":
      'import current from "./canvas.worker";export function double(value:number){return value*2;}export function spawn(){return new Worker(current as any);}',
  });
  const result = await bundleBrowser({
    absWorkingDir: cwd,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    format: "cjs",
    write: false,
    autoInstall: false,
  });
  let blob;
  vm.runInNewContext(result.outputFiles[0].text, {
    module: { exports: {} },
    Blob,
    URL: {
      createObjectURL(value) {
        blob = value;
        return "blob:worker";
      },
    },
  });
  const replies = [],
    context = { postMessage: (value) => replies.push(value) };
  context.self = context;
  vm.runInNewContext(await blob.text(), context);
  context.onmessage({ data: 21 });
  assert.deepEqual(replies, [42]);
});

test("a worker directly importing itself still reports a worker cycle", async (t) => {
  const cwd = await fixture(t, {
    "index.js": 'import url from "./a.worker";console.log(url);',
    "a.worker.js": 'import url from "./a.worker";new Worker(url);',
  });
  await assert.rejects(
    bundleBrowser({
      absWorkingDir: cwd,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
      logLevel: "silent",
    }),
    /Circular nested worker import/,
  );
});
