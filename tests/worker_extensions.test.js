import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { bundleBrowser, bundle } from "../tinybuild/esbuild/bundler.js";
import { fixture, terminalEnv } from "./helpers.js";
const execute = promisify(execFile);

test("nested Node workers execute factories and deliver results across two worker boundaries", async (t) => {
  const root = await fixture(t, {
    "package.json": '{"type":"module"}',
    "index.js":
      'import {createWorker} from "./outer.worker.js";const worker=createWorker();worker.once("message",value=>{console.log(value);worker.terminate();});',
    "outer.worker.js":
      'import {parentPort} from "node:worker_threads";import {createWorker} from "./leaf.worker.js";const leaf=createWorker();leaf.once("message",value=>{parentPort.postMessage(value*2);leaf.terminate();});',
    "leaf.worker.js":
      'import {parentPort} from "node:worker_threads";parentPort.postMessage(42);',
  });
  await bundle({
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    bundleBrowser: false,
    bundleNode: true,
    blobWorkers: false,
    autoInstall: false,
  });
  for (const color of [false, true]) {
    const result = await execute(process.execPath, ["dist/index.js"], {
      cwd: root,
      timeout: 5000,
      env: terminalEnv(color),
    });
    assert.equal(stripVTControlCharacters(result.stdout).trim(), "84");
    assert.equal(result.stdout.includes("\u001b["), color);
  }
});

test("nested file workers are returned with write:false without publishing child files", async (t) => {
  const root = await fixture(t, {
    "index.js":
      'import {createWorker} from "./outer.worker.js";createWorker();',
    "outer.worker.js":
      'import {createWorker} from "./leaf.worker.js";createWorker();',
    "leaf.worker.js": "postMessage(42);",
  });
  const result = await bundleBrowser({
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    blobWorkers: false,
    workerType: "module",
    write: false,
    autoInstall: false,
  });
  assert.equal(
    result.outputFiles.filter((file) => file.path.endsWith(".js")).length,
    3,
  );
  assert.ok(result.outputFiles.some((file) => /leaf\.worker-/.test(file.path)));
  assert.ok(Object.hasOwn(result.metafile.inputs, "leaf.worker.js"));
});

test("worker factories share blob URLs, release after the last termination and recreate after release", async (t) => {
  const root = await fixture(t, {
    "index.js":
      'export {createWorker,revokeWorkerURL} from "./task.worker.js";',
    "task.worker.js": "postMessage(42);",
  });
  const result = await bundleBrowser({
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    format: "cjs",
    write: false,
    workerType: "module",
    autoInstall: false,
  });
  const released = [],
    urls = [];
  const context = {
    exports: {},
    module: { exports: {} },
    Blob,
    URL: {
      createObjectURL: () => {
        const value = "blob:" + urls.length;
        urls.push(value);
        return value;
      },
      revokeObjectURL: (url) => released.push(url),
    },
    Worker: class {
      constructor(url, options) {
        this.url = url;
        this.options = options;
      }
      terminate() {
        this.terminated = true;
      }
    },
  };
  vm.runInNewContext(result.outputFiles[0].text, context);
  const { createWorker, revokeWorkerURL } = context.module.exports;
  const first = createWorker(),
    second = createWorker();
  assert.equal(first.options.type, "module");
  assert.equal(first.url, second.url);
  first.terminate();
  assert.equal(released.length, 0);
  second.terminate();
  second.terminate();
  assert.deepEqual(released, ["blob:0"]);
  const third = createWorker();
  assert.equal(third.url, "blob:1");
  third.terminate();
  revokeWorkerURL();
  assert.deepEqual(released, ["blob:0", "blob:1"]);
});

test("worker cycles and unknown declared runtime assets fail with actionable errors", async (t) => {
  const root = await fixture(t, {
    "index.js": 'import url from "./a.worker.js";console.log(url);',
    "a.worker.js": 'import url from "./b.worker.js";new Worker(url);',
    "b.worker.js": 'import url from "./a.worker.js";new Worker(url);',
    "bad.js": 'import asset from "tinybuild:asset/missing";console.log(asset);',
  });
  await assert.rejects(
    bundleBrowser({
      absWorkingDir: root,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
      logLevel: "silent",
    }),
    /Circular nested worker import/,
  );
  await assert.rejects(
    bundleBrowser({
      absWorkingDir: root,
      entryPoints: ["bad.js"],
      outfile: "dist/bad",
      runtimeAssets: {},
      autoInstall: false,
      logLevel: "silent",
    }),
    /Unknown runtime asset/,
  );
});
