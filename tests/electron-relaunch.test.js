import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { packager } from "../tinybuild/packager.js";
import { packageNative } from "../tinybuild/native.js";
import { electronLaunchOptions } from "../tinybuild/desktop.js";
import { fixture, until, delay } from "./helpers.js";

test("Electron relaunch settings reject release modes and invalid watcher paths or delays", async () => {
  for (const options of [
    { watch: 1 },
    { watch: [] },
    { watch: [4] },
    { watch: true, action: "make" },
    { restartDelay: -1 },
  ])
    assert.throws(() => electronLaunchOptions(options), /watch|restartDelay/);
  await assert.rejects(
    packageNative(
      { production: true, electron: { action: "open", watch: true } },
      [],
      { dryRun: true },
    ),
    /development mode/,
  );
  await assert.rejects(
    packageNative(
      { build: true, electron: { action: "open", watch: true } },
      [],
      { dryRun: true },
    ),
    /development mode/,
  );
});

test("Electron dry runs show the actual custom main/preload watch paths without launching a process", async (t) => {
  const cwd = await fixture(t, {
    "index.html": "app",
    "dist/index.js": "console.log(1);",
    "electron/package.json": JSON.stringify({ main: "custom.cjs" }),
  });
  const result = await packageNative(
    {
      bundler: { outdir: "dist" },
      server: false,
      electron: { action: "open", watch: true },
    },
    [],
    { cwd, dryRun: true },
  );
  assert.deepEqual(result.watched.electron, [
    path.join(cwd, "electron/custom.cjs"),
    path.join(cwd, "electron/electron_preload.js"),
  ]);
  await result.close();
});

test("main and preload saves relaunch once, frontend edits keep Electron running, and close cancels restarts", async (t) => {
  let app;
  t.after(() => app?.close());
  const main = `const fs=require("node:fs");const path=require("node:path");fs.appendFileSync(path.join(__dirname,"../launches.jsonl"),JSON.stringify({pid:process.pid,url:process.env.TINYBUILD_DEV_URL})+"\\n");setInterval(()=>{},10000);`;
  const cwd = await fixture(t, {
    "package.json": '{"type":"module"}',
    "index.js": "console.log(1);",
    "index.html": "app",
    "node_modules/electron/package.json":
      '{"name":"electron","main":"index.cjs"}',
    "node_modules/electron/index.cjs": "module.exports=process.execPath;",
    "electron/package.json": '{"main":"electron_app.js"}',
    "electron/electron_app.js": main,
    "electron/electron_preload.js": "// original preload",
  });
  const launches = async () =>
    (
      await fs
        .readFile(path.join(cwd, "launches.jsonl"), "utf8")
        .catch(() => "")
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
      },
      server: { host: "127.0.0.1", port: 0, delay: 50 },
      electron: { action: "open", watch: true, restartDelay: 250 },
    },
    { cwd },
  );
  const originalServer = app.server;
  await until(async () => (await launches()).length === 1);
  const first = (await launches())[0];
  assert.equal(first.url, app.server.url);
  await fs.writeFile(
    path.join(cwd, "electron/electron_app.js"),
    main + "\n// saved main",
  );
  await fs.writeFile(
    path.join(cwd, "electron/electron_preload.js"),
    "// saved preload",
  );
  await until(async () => (await launches()).length === 2);
  assert.notEqual((await launches())[1].pid, first.pid);
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(2);");
  await until(() => app.stats.builds === 2);
  await delay(400);
  assert.equal((await launches()).length, 2);
  assert.equal(app.server, originalServer);
  await fs.writeFile(
    path.join(cwd, "electron/electron_preload.js"),
    "// cancel pending restart",
  );
  await delay(100);
  await app.close();
  await delay(350);
  assert.equal((await launches()).length, 2);
  for (const { pid } of await launches())
    assert.throws(() => process.kill(pid, 0));
});
