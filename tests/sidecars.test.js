import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { fixture } from "./helpers.js";
import { packager } from "../tinybuild/packager.js";
import { loadConfig } from "../tinybuild/config.js";
import { packageNative } from "../tinybuild/native.js";
import { compileSidecar } from "../examples/tauri_sidecar/prepare-sidecar.mjs";

test("Electron packaging uses an installed runtime even without dependency declarations", async (t) => {
  const cwd = await fixture(t, {
    "package.json": '{"private":true}',
    "index.html": "<h1>app</h1>",
    "dist/index.js": "console.log(1);",
    "node_modules/electron/package.json":
      '{"name":"electron","version":"44.8.0","main":"index.js"}',
    "node_modules/electron/index.js": "module.exports='unused-in-this-test';",
    "node_modules/@electron/packager/package.json":
      '{"name":"@electron/packager","main":"index.js"}',
    "node_modules/@electron/packager/index.js": "",
  });
  const calls = [];
  await packageNative(
    {
      bundler: { outdir: "dist" },
      server: false,
      electron: { action: "package" },
    },
    [],
    { cwd, run: async (args) => calls.push(args) },
  );
  assert.equal(
    calls.length,
    1,
    "Use installed dependencies without reinstalling them",
  );
  assert.equal(calls[0][0], "electron-packager");
  const flag = calls[0].indexOf("--electron-version");
  assert.ok(flag >= 0);
  assert.equal(calls[0][flag + 1], "44.8.0");
});

for (const target of ["electron", "tauri"])
  test(`${target} sidecar example stages its custom shell without an SDK or rewriting unchanged backend sources`, async (t) => {
    const cwd = await fixture(t);
    const source = fileURLToPath(
      new URL(`../examples/${target}_sidecar/`, import.meta.url),
    );
    await fs.cp(source, cwd, {
      recursive: true,
      filter: (file) =>
        !path
          .relative(source, file)
          .split(path.sep)
          .some((part) =>
            [
              "node_modules",
              "dist",
              "electron",
              "src-tauri",
              ".tinybuild",
            ].includes(part),
          ),
    });
    const config = await loadConfig("tinybuild.config.js", source);
    const app = await packager(
      { ...config, build: true, server: false },
      { cwd },
    );
    await app.close();
    const main = path.join(
      cwd,
      target === "electron" ? "electron/app.cjs" : "src-tauri/src/main.rs",
    );
    const before = await fs.stat(main);
    assert.match(
      await fs.readFile(main, "utf8"),
      target === "electron"
        ? /utilityProcess\.fork/
        : /sidecar\("tinybuild-math-backend"\)/,
    );
    const again = await packager(
      { ...config, build: true, server: false },
      { cwd },
    );
    await again.close();
    assert.equal(
      (await fs.stat(main)).mtimeMs,
      before.mtimeMs,
      "Web builds must not touch unchanged native sources",
    );
    const staged = app.native.stages[target];
    assert.ok(
      !staged.files.some((name) => /backend|\.rs$|\.cjs$/.test(name)),
      "Backend code stays outside the public web directory",
    );
    if (target === "tauri") {
      const overlay = JSON.parse(
        await fs.readFile(
          path.join(cwd, ".tinybuild/native-tauri.json"),
          "utf8",
        ),
      );
      assert.deepEqual(overlay.bundle.externalBin, [
        "binaries/tinybuild-math-backend",
      ]);
      assert.equal(
        overlay.build.beforeBuildCommand,
        "node prepare-sidecar.mjs",
      );
      assert.equal(overlay.app.withGlobalTauri, true);
    } else {
      for (const watched of config.native.profiles.dev.targets.electron.watch)
        await fs.access(path.resolve(cwd, "electron", watched));
      assert.equal(
        JSON.parse(
          await fs.readFile(path.join(cwd, "electron/package.json"), "utf8"),
        ).main,
        "app.cjs",
      );
    }
  });

test("Tauri sidecar preparation honors explicit cross targets and passes paths as literal arguments", async (t) => {
  const cwd = await fixture(t),
    calls = [];
  const run = async (...args) => {
    calls.push(args);
    return { stdout: "host: aarch64-apple-darwin\n" };
  };
  const windows = await compileSidecar({
    cwd,
    target: "x86_64-pc-windows-msvc",
    run,
  });
  assert.ok(
    windows.endsWith("tinybuild-math-backend-x86_64-pc-windows-msvc.exe"),
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], [
    "--edition=2021",
    "--target",
    "x86_64-pc-windows-msvc",
    "-O",
    path.join(cwd, "backend.rs"),
    "-o",
    windows,
  ]);
  calls.length = 0;
  const mac = await compileSidecar({ cwd, run });
  assert.ok(mac.endsWith("tinybuild-math-backend-aarch64-apple-darwin"));
  assert.equal(calls[0][0], "rustc");
  await assert.rejects(
    compileSidecar({ cwd, target: "../unsafe", run }),
    /target triple/,
  );
  await assert.rejects(
    compileSidecar({ cwd, run: async () => ({ stdout: "unknown" }) }),
    /target triple/,
  );
  await assert.rejects(
    compileSidecar({
      cwd,
      target: "x86_64-pc-windows-msvc",
      run: async () => {
        throw Error("Compiler failed");
      },
    }),
    /Compiler failed/,
  );
});

test("Electron backend announces readiness, validates messages and exits on its private shutdown message", async () => {
  const source = await fs.readFile(
    new URL("../examples/electron_sidecar/native/backend.cjs", import.meta.url),
    "utf8",
  );
  const port = new EventEmitter(),
    replies = [],
    exits = [];
  port.postMessage = (message) => replies.push(message);
  vm.runInNewContext(source, {
    process: { parentPort: port, pid: 123, exit: (code) => exits.push(code) },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(replies.shift())), {
    type: "ready",
    pid: 123,
  });
  port.emit("message", { data: { id: 1, value: 7 } });
  assert.deepEqual(JSON.parse(JSON.stringify(replies.shift())), {
    id: 1,
    result: 49,
    pid: 123,
  });
  for (const value of [-1, Infinity, 1.5, 1000001, "7"]) {
    port.emit("message", { data: { id: 2, value } });
    assert.match(replies.shift().error, /integer/);
  }
  port.emit("message", { data: { type: "shutdown" } });
  assert.deepEqual(exits, [0]);
});
