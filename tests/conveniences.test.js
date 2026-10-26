import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, until } from "./helpers.js";
import {
  mobileDevelopment,
  mobileRunOptions,
  packager,
  previewConfig,
  validateConfig,
  copyAssets,
  cleanGenerated,
  recordOutputs,
} from "../tinybuild/packager.js";
import { runTinybuild } from "../tinybuild/cli.js";

test("mobile debug connections preserve the listening port, HTTPS and USB forwarding", () => {
  assert.deepEqual(
    mobileRunOptions("android", { liveReload: true }, "http://localhost:1234"),
    [
      "--live-reload",
      "--host",
      "localhost",
      "--port",
      "1234",
      "--forwardPorts",
      "1234:1234",
    ],
  );
  assert.deepEqual(
    mobileRunOptions(
      "android",
      { liveReload: true, connection: "emulator" },
      "https://localhost:4321",
    ),
    ["--live-reload", "--host", "10.0.2.2", "--port", "4321", "--https"],
  );
  assert.deepEqual(
    mobileRunOptions(
      "ios",
      { liveReload: true, connection: "lan", host: "192.168.1.42" },
      "http://localhost:8765",
    ),
    ["--live-reload", "--host", "192.168.1.42", "--port", "8765"],
  );
  assert.equal(
    mobileDevelopment({
      mobile: {
        android: { action: "run", liveReload: true, connection: "lan" },
      },
    }).server.host,
    "0.0.0.0",
  );
  assert.throws(
    () =>
      mobileDevelopment({
        build: true,
        mobile: { android: { action: "run", liveReload: true } },
      }),
    /development mode/,
  );
  assert.throws(
    () =>
      mobileDevelopment({
        server: false,
        mobile: { ios: { action: "run", liveReload: true } },
      }),
    /server enabled/,
  );
  assert.throws(
    () =>
      mobileRunOptions(
        "ios",
        { liveReload: true, connection: "usb" },
        "http://localhost",
      ),
    /iOS live reload/,
  );
});

test("mobile CLI launches a selected app with ephemeral port and enables live rebuild without persisting a dev URL", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "tinybuild.config.mjs": `export default {bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false},server:{host:'127.0.0.1',port:0,hotreload:false}}`,
    "index.js": "console.log(1)",
    "index.html": '<script src="dist/index.js"></script>',
  });
  app = await runTinybuild(["mobile=android", "--device", "emulator-5554"], {
    cwd,
    native: { dryRun: true },
  });
  const args = app.native.commands.find((args) => args.includes("run"));
  assert.ok(args.includes("emulator-5554"));
  assert.ok(args.includes("--live-reload"));
  assert.equal(args[args.indexOf("--port") + 1], String(app.server.port));
  assert.ok(!app.native.commands.some((args) => args.includes("sync")));
  assert.ok(
    !JSON.stringify(
      await fs.readFile(path.join(cwd, "capacitor.config.ts"), "utf8"),
    ).includes(app.server.url),
  );
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(2)");
  await until(() => app.stats.builds === 2);
});

test("config inspection is inert, redacts credentials, catches typos and accepts app metadata", async (t) => {
  const cwd = await fixture(t, {
    "tinybuild.js": 'throw new Error("should not run")',
  });
  const plan = await runTinybuild(["preview"], { cwd });
  assert.ok(plan.outputs.length);
  assert.deepEqual(await fs.readdir(cwd), ["tinybuild.js"]);
  const result = previewConfig({
    bundler: {
      plugins: [
        {
          name: "inert",
          setup() {
            throw new Error("no setup");
          },
        },
      ],
    },
    native: { env: { KEY: "sensitive" } },
    metadata: { custom: true },
  });
  assert.equal(result.config.native.env.KEY, "[redacted]");
  assert.equal(result.validation.errors.length, 0);
  assert.match(
    validateConfig({ bundler: { bundleBrower: true } }).warnings[0].message,
    /bundleBrowser/,
  );
  assert.equal(
    validateConfig({ strictConfig: true, bundler: { minfy: true } }).errors
      .length,
    1,
  );
  assert.equal(validateConfig({ server: { port: "1" } }).errors.length, 1);
});

test("asset copies remove stale owned files, preserve modified outputs and clean only recorded files", async (t) => {
  const cwd = await fixture(t, {
    "public/a.txt": "a",
    "public/b.txt": "b",
    "dist/user.txt": "keep",
  });
  await copyAssets([{ from: "public", to: "dist" }], { cwd });
  await fs.unlink(path.join(cwd, "public/b.txt"));
  await copyAssets([{ from: "public", to: "dist" }], { cwd });
  await assert.rejects(fs.access(path.join(cwd, "dist/b.txt")));
  await fs.writeFile(path.join(cwd, "dist/a.txt"), "edited");
  const clean = await cleanGenerated({ cwd });
  assert.deepEqual(clean.preserved, ["dist/a.txt"]);
  assert.equal(
    await fs.readFile(path.join(cwd, "dist/user.txt"), "utf8"),
    "keep",
  );
  await fs.writeFile(path.join(cwd, "dist/generated.js"), "build");
  await recordOutputs(["dist/generated.js"], { cwd });
  assert.ok(
    (await cleanGenerated({ cwd, dryRun: true })).removed.includes(
      "dist/generated.js",
    ),
  );
  await fs.access(path.join(cwd, "dist/generated.js"));
  await cleanGenerated({ cwd });
  await assert.rejects(fs.access(path.join(cwd, "dist/generated.js")));
});

test("copy plans reject escaping, overlapping, private files and unsafe cleanup manifests before writes", async (t) => {
  const cwd = await fixture(t, {
    "public/file.txt": "x",
    "private/.env": "secret",
  });
  await assert.rejects(
    copyAssets([{ from: "public", to: "../escape" }], { cwd }),
    /destination/,
  );
  await assert.rejects(
    copyAssets([{ from: "public", to: "public/nested" }], { cwd }),
    /inside its source/,
  );
  await assert.rejects(
    copyAssets([{ from: "private", to: "dist" }], { cwd }),
    /Private file/,
  );
  await assert.rejects(
    copyAssets(
      [
        { from: "public", to: "dist" },
        { from: "public", to: "dist" },
      ],
      { cwd },
    ),
    /overlap/,
  );
  await fs.mkdir(path.join(cwd, ".tinybuild"));
  await fs.writeFile(
    path.join(cwd, ".tinybuild/outputs.json"),
    JSON.stringify({
      version: 1,
      files: [{ path: "../outside", hash: "0".repeat(64) }],
    }),
  );
  await assert.rejects(cleanGenerated({ cwd }), /Unsafe/);
  await assert.rejects(fs.access(path.join(cwd, "dist")));
});

test("copy-only projects build and watch copied assets through the normal reload pipeline", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "public/logo.svg": "<svg/>",
    "index.html": "<h1>copy</h1>",
  });
  app = await packager(
    {
      bundler: false,
      copy: [{ from: "public", to: "dist" }],
      server: { port: 0, host: "127.0.0.1" },
    },
    { cwd },
  );
  assert.equal(app.stats.outputBytes, 6);
  await fs.writeFile(path.join(cwd, "public/logo.svg"), "<svg>new</svg>");
  await until(() => app.stats.builds === 2);
  assert.equal(
    await fs.readFile(path.join(cwd, "dist/logo.svg"), "utf8"),
    "<svg>new</svg>",
  );
});

test("profile resolution preserves explicit mobile debug overrides and memory-only builds own no disk outputs", async (t) => {
  const { nativeApp, resolveNativeConfig, selectNativeProfile } =
    await import("../tinybuild/native-config.js");
  const profiled = {
    ...nativeApp({
      profiles: {
        debug: { targets: { mobile: { android: "stage" } } },
        release: { targets: { mobile: { ios: "stage" } } },
      },
    }),
    profile: "debug",
  };
  const resolved = resolveNativeConfig(profiled);
  const mobile = { android: { action: "run", liveReload: true } };
  assert.equal(resolveNativeConfig({ ...resolved, mobile }).mobile, mobile);
  assert.equal(
    resolveNativeConfig(selectNativeProfile(resolved, "release")).native
      .profile,
    "release",
  );
  const cwd = await fixture(t, { "index.js": "console.log(42);" });
  const app = await packager(
    {
      build: true,
      server: false,
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        write: false,
        autoInstall: false,
      },
      diagnostics: { compression: true },
    },
    { cwd },
  );
  await app.close();
  assert.ok(app.report.gzipBytes > 0);
  assert.deepEqual(await fs.readdir(cwd), ["index.js"]);
});
