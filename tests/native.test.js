import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { bundle } from "../tinybuild/esbuild/bundler.js";
import {
  stageWeb,
  packageNative,
  outputDirectory,
  generatePWA,
} from "../tinybuild/native.js";
import { fixture } from "./helpers.js";

async function web(t) {
  const root = await fixture(t, {
    "index.html": '<script src="dist/index.js"></script>',
    "index.js": 'import worker from "./task.worker.js"; console.log(worker);',
    "task.worker.js": "self.postMessage(42);",
    "assets/data.txt": "asset",
  });
  const config = {
    bundler: {
      absWorkingDir: root,
      entryPoints: ["index.js"],
      outdir: "dist",
      blobWorkers: false,
      autoInstall: false,
    },
    assets: ["assets"],
  };
  return { root, config, results: await bundle(config.bundler) };
}
test("staging includes HTML, workers and assets, and removes only previously generated stale files", async (t) => {
  const { root, config, results } = await web(t);
  const first = await stageWeb(config, results, "staged web", { cwd: root });
  assert.ok(first.files.includes("index.html"));
  assert.ok(first.files.some((file) => file.includes("task.worker-")));
  await fs.access(path.join(first.directory, "assets/data.txt"));
  await fs.writeFile(path.join(first.directory, "custom.txt"), "preserve");
  config.assets = [];
  await stageWeb(config, results, "staged web", { cwd: root });
  await assert.rejects(
    fs.access(path.join(first.directory, "assets/data.txt")),
  );
  assert.equal(
    await fs.readFile(path.join(first.directory, "custom.txt"), "utf8"),
    "preserve",
  );
});
test("native adapters accept outdir, preserve custom files, select platform directories and await commands", async (t) => {
  const { root, config, results } = await web(t);
  config.electron = { action: "stage" };
  config.tauri = { action: "stage" };
  config.mobile = { android: "open", ios: "open" };
  await fs.mkdir(path.join(root, "android"));
  await fs.mkdir(path.join(root, "electron"));
  await fs.writeFile(
    path.join(root, "electron/electron_app.js"),
    "keep native customizations",
  );
  const result = await packageNative(config, results, {
    cwd: root,
    dryRun: true,
  });
  assert.equal(outputDirectory(config.bundler, root), path.join(root, "dist"));
  assert.equal(
    await fs.readFile(path.join(root, "electron/electron_app.js"), "utf8"),
    "keep native customizations",
  );
  assert.ok(result.commands.some((args) => args.join(" ") === "cap add ios"));
  assert.ok(
    !result.commands.some((args) => args.join(" ") === "cap add android"),
  );
  assert.ok(result.stages.electron.files.includes("index.html"));
  assert.match(
    await fs.readFile(path.join(root, "src-tauri/Cargo.toml"), "utf8"),
    /version = "2"/,
  );
});
test("native command failures propagate and explicit Electron packaging chooses its packager", async (t) => {
  const { root, config, results } = await web(t);
  config.electron = { action: "package", name: "Example" };
  // Dependency checks are bypassed only in a dry-run. A fixture runner can verify its plan.
  const plan = await packageNative(config, results, {
    cwd: root,
    dryRun: true,
  });
  assert.deepEqual(plan.commands[0].slice(0, 3), [
    "electron-packager",
    path.join(root, "electron"),
    "Example",
  ]);
  config.mobile = { ios: "open" };
  config.electron = false;
  await fs.mkdir(path.join(root, "node_modules/@capacitor/cli"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "node_modules/@capacitor/cli/package.json"),
    '{"main":"index.js"}',
  );
  await fs.writeFile(
    path.join(root, "node_modules/@capacitor/cli/index.js"),
    "",
  );
  await assert.rejects(
    packageNative(config, results, {
      cwd: root,
      run: async () => {
        throw new Error("native failed");
      },
    }),
    /native failed/,
  );
});
test("staging rejects secrets, outside assets, and unsafe stale-file manifests", async (t) => {
  const { root, config, results } = await web(t);
  await fs.writeFile(path.join(root, "signing.jks"), "private");
  await assert.rejects(
    stageWeb({ ...config, assets: ["signing.jks"] }, results, "stage", {
      cwd: root,
    }),
    /Private file/,
  );
  await fs.mkdir(path.join(root, "stage"), { recursive: true });
  await fs.writeFile(
    path.join(root, "stage/.tinybuild-manifest.json"),
    '["../index.js"]',
  );
  await assert.rejects(
    stageWeb(config, results, "stage", { cwd: root }),
    /Invalid staging manifest/,
  );
});
test("PWA assets come from real outputs and content changes update the version", async (t) => {
  const { root, config, results } = await web(t);
  const first = await generatePWA({
    cwd: root,
    filename: "service-worker.js",
    results,
  });
  assert.ok(first.assets.some((file) => file.includes("task.worker-")));
  const original = await fs.readFile(first.filename, "utf8");
  assert.doesNotMatch(original, /__TINYBUILD_/);
  await fs.appendFile(path.join(root, "dist/index.js"), "\nconsole.log(99);");
  const next = await generatePWA({
    cwd: root,
    filename: "service-worker.js",
    results,
  });
  assert.notEqual(first.version, next.version);
  let fetchHandler;
  const context = {
    self: {
      registration: { scope: "http://localhost/" },
      location: { origin: "http://localhost" },
      addEventListener(name, fn) {
        if (name === "fetch") fetchHandler = fn;
      },
    },
    caches: { match: async () => undefined },
    fetch: async () => {
      throw new Error("offline");
    },
    URL,
    Response,
  };
  vm.runInNewContext(original, context);
  let response;
  fetchHandler({
    request: { method: "GET", url: "http://localhost/missing" },
    respondWith(promise) {
      response = promise;
    },
  });
  assert.equal((await response).status, 503);
});

test("staging a custom HTML name creates the native index entry without installing SDKs", async (t) => {
  const root = await fixture(t, {
    "pages/home.html": '<script src="./dist/app.js"></script>',
    "pages/dist/app.js": "console.log(1);",
  });
  const config = {
    bundler: { outdir: "pages/dist" },
    server: { startpage: "pages/home.html" },
    electron: { action: "stage" },
    mobile: { android: "stage", ios: "stage" },
    tauri: { action: "stage" },
  };
  const result = await packageNative(config, [], {
    cwd: root,
    run: async () => {
      throw new Error("Stage must not run a package manager");
    },
  });
  assert.match(
    await fs.readFile(path.join(root, "electron/web/index.html"), "utf8"),
    /app.js/,
  );
  assert.deepEqual(result.commands, []);
});
test("sidecar staging uses a validated Rust target and built-in process tools", async (t) => {
  const root = await fixture(t, { "program.bin": "executable fixture" });
  const { stageSidecar } =
    await import("../tinybuild/templates/src-tauri/createExecutable.js");
  const destination = await stageSidecar("program.bin", {
    cwd: root,
    run: async () => ({ stdout: "host: x86_64-pc-windows-msvc\n" }),
  });
  assert.equal(await fs.readFile(destination, "utf8"), "executable fixture");
  await assert.rejects(
    stageSidecar("program.bin", {
      cwd: root,
      run: async () => ({ stdout: "host: ../escape\n" }),
    }),
    /target triple/,
  );
});
