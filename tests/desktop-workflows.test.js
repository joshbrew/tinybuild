import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fixture, until, delay, request } from "./helpers.js";
import {
  packager,
  packageNative,
  desktopDevelopment,
  electronLaunchOptions,
  tauriCommand,
} from "../tinybuild/packager.js";
import { runTinybuild } from "../tinybuild/cli.js";

test("desktop debug shortcuts use the actual server URL without requiring native macros", async (t) => {
  const cwd = await fixture(t, {
    "tinybuild.config.mjs":
      'export default {bundler:{entryPoints:["index.js"],outfile:"dist/index",autoInstall:false},server:{host:"127.0.0.1",port:0}};',
    "index.js": "console.log(1);",
    "index.html": '<script src="dist/index.js"></script>',
  });
  for (const target of ["electron", "tauri"]) {
    const app = await runTinybuild(
      [
        "desktop=" + target,
        ...(target === "electron" ? ["--devtools", "--inspect", "9333"] : []),
      ],
      { cwd, native: { dryRun: true } },
    );
    try {
      if (target === "electron") {
        const args = app.native.commands.find((args) => args[0] === "electron");
        assert.ok(args.includes("--inspect=9333"));
        const settings = JSON.parse(
          await fs.readFile(
            path.join(cwd, "electron/tinybuild-app.json"),
            "utf8",
          ),
        );
        assert.equal(settings.devtools, true);
      } else {
        const overlay = JSON.parse(
          await fs.readFile(app.native.config.tauriFile, "utf8"),
        );
        assert.equal(overlay.build.devUrl, app.server.url);
        assert.ok(
          overlay.app.security.devCsp.includes(
            app.server.url.replace(/^http/, "ws"),
          ),
        );
      }
    } finally {
      await app.close();
    }
  }
});

test("Electron launch flags and Tauri build/dev options validate and remain explicit", () => {
  assert.deepEqual(
    electronLaunchOptions({
      inspect: 0,
      args: ["--demo"],
      window: { width: 1024, resizable: false },
    }).flags,
    ["--inspect=0"],
  );
  assert.throws(() => electronLaunchOptions({ inspect: "9333" }), /inspect/);
  assert.throws(
    () =>
      electronLaunchOptions({
        window: { webPreferences: { nodeIntegration: true } },
      }),
    /Unsupported/,
  );
  assert.throws(
    () => electronLaunchOptions({ window: { minWidth: -1 } }),
    /positive/,
  );
  assert.deepEqual(
    tauriCommand(
      {
        action: "build",
        features: ["demo", "logging"],
        debug: true,
        noBundle: true,
      },
      "overlay.json",
    ),
    [
      "tauri",
      "build",
      "--config",
      "overlay.json",
      "--features",
      "demo,logging",
      "--debug",
      "--no-bundle",
    ],
  );
  assert.ok(
    tauriCommand({ action: "dev", watch: false }).includes("--no-watch"),
  );
  assert.throws(
    () => tauriCommand({ action: "dev", bundles: ["nsis"] }),
    /apply to build/,
  );
  assert.throws(
    () =>
      desktopDevelopment({
        server: false,
        electron: { action: "open", liveReload: true },
      }),
    /enabled server/,
  );
});

test("Electron development loads the live URL; packaged apps ignore it and retain isolated renderer settings", async () => {
  const source = await fs.readFile(
    new URL("../tinybuild/templates/electron_app.js", import.meta.url),
    "utf8",
  );
  for (const packaged of [false, true]) {
    const calls = [];
    let options;
    class BrowserWindow {
      constructor(value) {
        options = value;
        this.webContents = {
          openDevTools: (value) => calls.push(["tools", value]),
          setWindowOpenHandler: (fn) => assert.equal(fn().action, "deny"),
        };
      }
      loadURL(url) {
        calls.push(["url", url]);
      }
      loadFile(file) {
        calls.push(["file", file]);
      }
    }
    const app = {
      isPackaged: packaged,
      setAppUserModelId() {},
      whenReady: () => Promise.resolve(),
      on() {},
      quit() {},
    };
    vm.runInNewContext(source, {
      __dirname: "/shell",
      process: {
        env: { TINYBUILD_DEV_URL: "http://localhost:8123" },
        platform: "win32",
      },
      require: (name) =>
        name === "electron"
          ? { app, BrowserWindow }
          : name === "node:path"
            ? path
            : {
                existsSync: () => true,
                readFileSync: () =>
                  JSON.stringify({ devtools: true, window: { width: 1024 } }),
              },
    });
    await Promise.resolve();
    assert.equal(calls[0][0], packaged ? "file" : "url");
    assert.equal(options.width, 1024);
    assert.equal(options.webPreferences.nodeIntegration, false);
    assert.equal(options.webPreferences.contextIsolation, true);
    assert.equal(
      calls.some((call) => call[0] === "tools"),
      !packaged,
    );
  }
});

test("release plans discard inherited debug URLs, expose artifact directories and preserve custom shells", async (t) => {
  const cwd = await fixture(t, {
    "index.html": "hello",
    "electron/electron_app.js": "// custom shell",
    "dist/index.js": "1;",
  });
  const plan = await packageNative(
    {
      native: { id: "com.example.desktop", devUrl: true },
      electron: { action: "package", outdir: "release" },
      tauri: { action: "build", debug: true, noBundle: true },
      bundler: { outdir: "dist" },
    },
    [],
    { cwd, dryRun: true },
  );
  assert.equal(plan.config.devUrl, undefined);
  assert.deepEqual(plan.artifactDirectories, [
    path.join(cwd, "release"),
    path.join(cwd, "src-tauri/target/debug"),
  ]);
  const overlay = JSON.parse(await fs.readFile(plan.config.tauriFile, "utf8"));
  assert.equal(overlay.build.devUrl, undefined);
  assert.equal(
    await fs.readFile(path.join(cwd, "electron/electron_app.js"), "utf8"),
    "// custom shell",
  );
});

test("unchanged server config survives bundler changes; invalid config recovers without closing the listener", async (t) => {
  let app;
  t.after(() => app?.close());
  const definition = (label) => ({
    bundler: {
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
      define: { LABEL: String(label) },
    },
    server: { host: "127.0.0.1", port: 0 },
    tasks: {},
  });
  const cwd = await fixture(t, {
    "index.js": "console.log(LABEL);",
    "index.html": "hello",
    "tinybuild.config.mjs": "export default " + JSON.stringify(definition(1)),
  });
  const errors = [];
  app = await packager(definition(1), {
    cwd,
    configPath: "tinybuild.config.mjs",
    onError: (error) => errors.push(error),
  });
  const original = app.server;
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default " +
      JSON.stringify({ ...definition(2), server: { port: "bad" } }),
  );
  await until(() => errors.length > 0);
  assert.equal(app.server, original);
  assert.equal((await request(original.SERVER)).status, 200);
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default " + JSON.stringify(definition(2)),
  );
  await until(() => app.stats.builds === 2);
  assert.equal(app.server, original);
  assert.equal(app.server.SOCKETS.hotreload.lastError, null);
});

test("config reload refreshes extra watch roots and copied assets", async (t) => {
  let app;
  t.after(() => app?.close());
  const parent = await fixture(t, {
    "app/index.js": "console.log(1);",
    "app/index.html": "hello",
    "shared/settings.txt": "one",
  });
  const cwd = path.join(parent, "app");
  const config = (copy) => ({
    bundler: {
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
    },
    server: { host: "127.0.0.1", port: 0 },
    ...(copy ? { copy: [{ from: "../shared", to: "dist/shared" }] } : {}),
  });
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default " + JSON.stringify(config(false)),
  );
  app = await packager(config(false), {
    cwd,
    configPath: "tinybuild.config.mjs",
  });
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default " + JSON.stringify(config(true)),
  );
  await until(() => app.stats.builds === 2);
  await fs.writeFile(path.join(parent, "shared/settings.txt"), "two");
  await until(() => app.stats.builds === 3);
  assert.equal(
    await fs.readFile(path.join(cwd, "dist/shared/settings.txt"), "utf8"),
    "two",
  );
  await delay(200);
  assert.equal(app.stats.builds, 3);
});

test("desktop URL status remains available while a native development command is running", async (t) => {
  const cwd = await fixture(t, {
    "tinybuild.config.mjs":
      'export default {bundler:{entryPoints:["index.js"],outfile:"dist/index",autoInstall:false},server:{host:"127.0.0.1",port:0}};',
    "index.js": "console.log(1);",
    "index.html": "hello",
  });
  const lines = [];
  const log = console.log;
  console.log = (...values) => lines.push(values.join(" "));
  let app,
    release,
    launched = false;
  const starting = runTinybuild(["desktop=electron"], {
    cwd,
    onReady: (value) => (app = value),
    native: {
      run: async (args) => {
        if (args[0] === "electron") {
          launched = true;
          await new Promise((resolve) => (release = resolve));
        }
      },
    },
  });
  try {
    await until(() => launched);
    await fs.writeFile(path.join(cwd, "index.js"), "console.log(2);");
    await until(() => app.stats.builds === 2);
    assert.equal(lines.at(-1), "Tinybuild listening at " + app.server.url);
  } finally {
    release?.();
    await starting;
    assert.equal(lines.at(-1), "Tinybuild listening at " + app.server.url);
    await app?.close();
    console.log = log;
  }
});

test("failed listener replacements restore the working port and can recover on another save", async (t) => {
  let app;
  t.after(() => app?.close());
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const busy = createServer();
  busy.listen(0, "127.0.0.1");
  await once(busy, "listening");
  t.after(() => new Promise((resolve) => busy.close(resolve)));
  const config = {
    bundler: {
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
    },
    server: { host: "127.0.0.1", port: 0 },
  };
  const cwd = await fixture(t, {
    "index.js": "console.log(1);",
    "index.html": "healthy",
    "tinybuild.config.mjs": "export default " + JSON.stringify(config),
  });
  const errors = [];
  app = await packager(config, {
    cwd,
    configPath: "tinybuild.config.mjs",
    onError: (error) => errors.push(error),
  });
  const url = app.server.url;
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default " +
      JSON.stringify({
        ...config,
        server: { ...config.server, port: busy.address().port },
      }),
  );
  await until(() => errors.length > 0);
  assert.equal(app.server.url, url);
  assert.equal(
    (await request(app.server.SERVER)).body.includes("healthy"),
    true,
  );
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default " + JSON.stringify(config),
  );
  await until(() => app.stats.builds === 2);
  assert.equal(app.server.url, url);
});

test("desktop release signing receives output locations and no inherited live URL", async (t) => {
  const cwd = await fixture(t, {
    "index.html": "desktop",
    "dist/index.js": "1;",
  });
  const environments = [];
  const result = await packageNative(
    {
      native: {
        id: "com.example.release",
        devUrl: true,
        env: { TINYBUILD_DEV_URL: "http://debug.invalid" },
        signing: { command: ["sign-app"] },
      },
      electron: { action: "package" },
      bundler: { outdir: "dist" },
    },
    [],
    {
      cwd,
      run: async (_args, options) => environments.push(options.env),
      sign: async (_command, _args, options) => environments.push(options.env),
    },
  );
  assert.ok(environments.every((env) => !env.TINYBUILD_DEV_URL));
  assert.deepEqual(
    JSON.parse(environments.at(-1).TINYBUILD_ARTIFACT_DIRS),
    result.artifactDirectories,
  );
});

test("portable HTML output moves update the live entry without replacing an unchanged server", async (t) => {
  let app;
  t.after(() => app?.close());
  const definition = (value) => ({
    bundler: {
      entryPoints: ["index.js"],
      outfile: value === 1 ? "dist/index" : "output/app",
      bundleHTML: true,
      autoInstall: false,
      define: { LABEL: String(value) },
    },
    server: { host: "127.0.0.1", port: 0 },
  });
  const cwd = await fixture(t, {
    "index.js": "console.log(LABEL);",
    "tinybuild.config.mjs": "export default " + JSON.stringify(definition(1)),
  });
  app = await packager(definition(1), {
    cwd,
    configPath: "tinybuild.config.mjs",
  });
  const original = app.server;
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default " + JSON.stringify(definition(2)),
  );
  await until(() => app.stats.builds === 2);
  assert.equal(app.server, original);
  assert.match((await request(app.server.SERVER)).body, /console.log\(2\)/);
});

test("closing a ready desktop controller cancels its active native command", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "console.log(1);",
    "index.html": "desktop",
  });
  let app,
    launched = false;
  const starting = packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
      },
      server: { host: "127.0.0.1", port: 0 },
      electron: { action: "open", liveReload: true },
    },
    {
      cwd,
      onReady: (value) => (app = value),
      native: {
        run: async (args, { signal }) => {
          if (args[0] === "electron") {
            launched = true;
            await new Promise((resolve, reject) =>
              signal.addEventListener(
                "abort",
                () => reject(new Error("Native command cancelled")),
                { once: true },
              ),
            );
          }
        },
      },
    },
  );
  const finished = assert.rejects(starting, /cancelled/);
  await until(() => launched);
  await app.close();
  await finished;
  assert.equal(app.server.SERVER.listening, false);
});

test("closing during onReady prevents late desktop launch", async (t) => {
  const cwd = await fixture(t, { "index.js": "1;", "index.html": "desktop" });
  let calls = 0;
  await assert.rejects(
    packager(
      {
        bundler: {
          entryPoints: ["index.js"],
          outfile: "dist/index",
          autoInstall: false,
        },
        server: { host: "127.0.0.1", port: 0 },
        electron: { action: "open" },
      },
      {
        cwd,
        onReady: (app) => app.close(),
        native: { run: async () => calls++ },
      },
    ),
    /startup aborted/,
  );
  assert.equal(calls, 0);
});

test("desktop shortcuts keep explicit CLI overrides while accepting later server config edits", async (t) => {
  let app;
  t.after(() => app?.close());
  const definition = (revision) => ({
    bundler: {
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
    },
    server: { host: "127.0.0.1", port: 0, headers: { "X-Revision": revision } },
  });
  const cwd = await fixture(t, {
    "index.js": "1;",
    "index.html": "desktop",
    "tinybuild.config.mjs":
      "export default " + JSON.stringify(definition("one")),
  });
  app = await runTinybuild(["desktop=electron"], {
    cwd,
    native: { dryRun: true },
  });
  const url = app.server.url;
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default " + JSON.stringify(definition("two")),
  );
  await until(() => app.stats.builds === 2);
  assert.equal((await request(app.server.SERVER)).headers["x-revision"], "two");
  assert.equal(app.server.url, url);
});

test("native development waits for a successful frontend build while the server stays available", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "index.js": "const = ;",
    "index.html": '<h1>Recovery</h1><script src="dist/index.js"></script>',
  });
  let launches = 0;
  const starting = packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
        logLevel: "silent",
      },
      server: { host: "127.0.0.1", port: 0 },
      electron: { action: "open", liveReload: true },
    },
    {
      cwd,
      onReady: (value) => (app = value),
      onError: () => {},
      native: {
        run: async (args) => {
          if (args[0] === "electron") launches++;
        },
      },
    },
  );
  starting.catch(() => {});
  await until(() => app?.server);
  assert.equal(launches, 0);
  assert.equal((await request(app.server.SERVER)).status, 200);
  assert.ok(app.server.SOCKETS.hotreload.lastError);
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(42);");
  await starting;
  assert.equal(launches, 1);
  assert.equal(app.server.SOCKETS.hotreload.lastError, null);
});

test("closing an errored native startup cancels the wait without launching SDK commands", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "index.js": "const = ;",
    "index.html": "recoverable",
  });
  let calls = 0;
  const starting = packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
        logLevel: "silent",
      },
      server: { host: "127.0.0.1", port: 0 },
      tauri: { action: "dev", liveReload: true },
    },
    {
      cwd,
      onReady: (value) => (app = value),
      onError: () => {},
      native: { run: async () => calls++ },
    },
  );
  const stopped = assert.rejects(starting, /startup aborted/);
  await until(() => app?.server);
  await app.close();
  await stopped;
  assert.equal(calls, 0);
});
