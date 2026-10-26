import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { packager } from "../tinybuild/packager.js";
import { bundle } from "../tinybuild/esbuild/bundler.js";
import { packageNative, stageWeb } from "../tinybuild/native.js";
import { desktopDevelopment } from "../tinybuild/desktop.js";
import { mobileDevelopment } from "../tinybuild/mobile.js";
import { startTasks } from "../tinybuild/tasks.js";
import { serve } from "../tinybuild/node_server/server.js";
import { fixture, until, delay, request } from "./helpers.js";

async function appFixture(t, extra = {}, options = {}) {
  const cwd = await fixture(t, {
    "index.js": "console.log(1);",
    "index.html":
      '<html><link rel="stylesheet" href="/plain.css"><script src="/dist/index.js"></script></html>',
    "plain.css": "body{color:red}",
    ...extra,
  });
  const app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
        minify: true,
        logLevel: options.logLevel,
      },
      server: { host: "127.0.0.1", port: 0, delay: 100 },
      ...options.config,
    },
    { cwd, ...options, onError: () => {} },
  );
  t.after(() => app.close().catch(() => {}));
  const socket = new WebSocket(
    app.server.url.replace("http:", "ws:") + "/hotreload",
  );
  t.after(() => socket.terminate());
  await once(socket, "open");
  const messages = [];
  socket.on("message", (data) => messages.push(JSON.parse(data)));
  return { cwd, app, messages };
}

test("mixed source/static saves keep HTML and plain CSS in one settled reload, even if JS output is unchanged", async (t) => {
  const { cwd, app, messages } = await appFixture(t);
  await fs.writeFile(
    path.join(cwd, "index.js"),
    "console.log(1); // minified away",
  );
  await fs.writeFile(path.join(cwd, "index.html"), "<html>updated</html>");
  await fs.writeFile(path.join(cwd, "plain.css"), "body{color:green}");
  await until(() => messages.some((message) => message.type === "built"));
  await delay(180);
  const builds = messages.filter((message) => message.type === "built");
  assert.equal(builds.length, 1);
  assert.deepEqual(builds[0].files.sort(), ["/index.html", "/plain.css"]);
  assert.equal(app.stats.builds, 2);
});

test("plain stylesheets update directly without rebuilding JavaScript", async (t) => {
  const { cwd, app, messages } = await appFixture(t);
  await fs.writeFile(path.join(cwd, "plain.css"), "body{color:green}");
  await until(() => messages.length);
  assert.deepEqual(messages[0].files, ["/plain.css"]);
  assert.equal(app.stats.builds, 1);
});

test("static saves retain build errors and readiness until source recovers", async (t) => {
  const { cwd, app, messages } = await appFixture(
    t,
    {},
    { logLevel: "silent" },
  );
  await fs.writeFile(path.join(cwd, "index.js"), "const = broken;");
  await until(() => messages.some((message) => message.type === "error"));
  messages.length = 0;
  await fs.writeFile(
    path.join(cwd, "index.html"),
    "<html>saved during error</html>",
  );
  await until(() => messages.some((message) => message.type === "error"));
  assert.equal(
    messages.some((message) => message.type === "built"),
    false,
  );
  assert.equal(
    (await request(app.server.SERVER, "/_tinybuild/ready")).status,
    503,
  );
  const nextClient = new WebSocket(
    app.server.url.replace("http:", "ws:") + "/hotreload",
  );
  t.after(() => nextClient.terminate());
  const [data] = await once(nextClient, "message");
  assert.equal(JSON.parse(data).type, "error");
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(2);");
  await until(() => messages.some((message) => message.type === "built"));
  assert.ok(
    messages
      .find((message) => message.type === "built")
      .files.includes("/index.html"),
  );
  assert.equal(
    (await request(app.server.SERVER, "/_tinybuild/ready")).status,
    200,
  );
});

test("static saves cannot clear an invalid-config overlay before the config is repaired", async (t) => {
  const source =
    "export default {bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false,minify:true},server:{host:'127.0.0.1',port:0,delay:100}};";
  const { cwd, app, messages } = await appFixture(
    t,
    { "tinybuild.config.mjs": source },
    { configPath: "tinybuild.config.mjs" },
  );
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default {server:{port:'bad'}};",
  );
  await until(() => messages.some((message) => message.type === "error"));
  messages.length = 0;
  await fs.writeFile(
    path.join(cwd, "index.html"),
    "<html>edited with invalid config</html>",
  );
  await until(() => messages.length);
  assert.equal(messages[0].type, "error");
  assert.equal(app.stats.builds, 1);
  await fs.writeFile(path.join(cwd, "tinybuild.config.mjs"), source);
  await until(() => messages.some((message) => message.type === "built"));
  assert.equal(app.stats.builds, 2);
  assert.ok(
    messages
      .find((message) => message.type === "built")
      .files.includes("/index.html"),
  );
});

test("static saves arriving during a source build also publish its changed JavaScript", async (t) => {
  let release,
    blocked = false,
    slow = false;
  t.after(() => release?.());
  const { cwd, app, messages } = await appFixture(
    t,
    {},
    {
      config: {
        bundler: {
          entryPoints: ["index.js"],
          outfile: "dist/index",
          autoInstall: false,
          plugins: [
            {
              name: "slow-final-pass",
              setup(build) {
                build.onStart(async () => {
                  if (slow) {
                    slow = false;
                    blocked = true;
                    await new Promise((resolve) => (release = resolve));
                  }
                });
              },
            },
          ],
        },
      },
    },
  );
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(42);");
  // Use an explicit slow rebuild after the file's first settled output.
  await until(() => app.stats.builds === 2);
  await until(() => messages.some((message) => message.type === "built"));
  messages.length = 0;
  slow = true;
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(43);");
  await until(() => blocked);
  let staticObserved = false;
  app.watcher.on("all", (event, filename) => {
    if (
      event === "change" &&
      path.resolve(filename) === path.join(cwd, "index.html")
    )
      staticObserved = true;
  });
  await fs.writeFile(
    path.join(cwd, "index.html"),
    "<html>new static page</html>",
  );
  await until(() => staticObserved);
  release();
  await until(() => messages.some((message) => message.type === "built"));
  const built = messages.filter((message) => message.type === "built");
  assert.equal(built.length, 1);
  assert.ok(built[0].files.includes("/dist/index.js"));
  assert.ok(built[0].files.includes("/index.html"));
});

test("saves during the first build are watched and native staging waits for settled output", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "console.log(1);",
    "index.html": "<html>app</html>",
  });
  let release,
    blocked = false,
    first = true;
  t.after(() => release?.());
  const starting = packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
        plugins: [
          {
            name: "hold-first-output",
            setup(build) {
              build.onEnd(async () => {
                if (first) {
                  first = false;
                  blocked = true;
                  await new Promise((resolve) => (release = resolve));
                }
              });
            },
          },
        ],
      },
      server: { host: "127.0.0.1", port: 0, delay: 30 },
      electron: { action: "stage" },
    },
    { cwd },
  );
  starting.catch(() => {});
  await until(() => blocked);
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(77);");
  await delay(150);
  release();
  const app = await starting;
  t.after(() => app.close());
  assert.equal(app.stats.builds, 2);
  assert.match(
    await fs.readFile(path.join(cwd, "electron/web/dist/index.js"), "utf8"),
    /77/,
  );
});

test("root output directories and custom native stage folders do not break source watching", async (t) => {
  const { cwd, app, messages } = await appFixture(
    t,
    { "src/app.ts": "console.log(1);" },
    {
      config: {
        bundler: {
          entryPoints: ["src/app.ts"],
          outdir: ".",
          autoInstall: false,
        },
        electron: { action: "stage", directory: "custom-shell" },
      },
    },
  );
  await delay(250);
  const before = app.stats.builds;
  await fs.writeFile(
    path.join(cwd, "custom-shell/web/app.js"),
    "// owned staged output",
  );
  await delay(250);
  assert.equal(app.stats.builds, before);
  messages.length = 0;
  await fs.writeFile(path.join(cwd, "src/app.ts"), "console.log(88);");
  await until(() => messages.some((message) => message.type === "built"));
  assert.match(await fs.readFile(path.join(cwd, "app.js"), "utf8"), /88/);
});

test("editing hotreload pauses source saves but keeps config watching for re-enabling it", async (t) => {
  const config = (hotreload) =>
    `export default {bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false},server:{host:'127.0.0.1',port:0,delay:30,hotreload:${hotreload},extensions:['css']}};`;
  const { cwd, app } = await appFixture(
    t,
    { "tinybuild.config.mjs": config(true) },
    { configPath: "tinybuild.config.mjs" },
  );
  await fs.writeFile(path.join(cwd, "tinybuild.config.mjs"), config(false));
  await until(() => app.stats.builds === 2);
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(99);");
  await fs.writeFile(path.join(cwd, "plain.css"), "body{color:blue}");
  await delay(250);
  assert.equal(app.stats.builds, 2);
  await fs.writeFile(path.join(cwd, "tinybuild.config.mjs"), config(true));
  await until(() => app.stats.builds === 3);
  assert.match((await request(app.server.SERVER, "/dist/index.js")).body, /99/);
});

test("native launch/address config changes preserve the current working session and request a restart", async (t) => {
  const config = (port, name = "First") =>
    `export default {bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false},server:{host:'127.0.0.1',port:${port},delay:30},native:{id:'com.example.finalpass',name:'${name}'},electron:{action:'open',liveReload:true}};`;
  const errors = [];
  const cwd = await fixture(t, {
    "index.js": "console.log(1);",
    "index.html": "app",
    "tinybuild.config.mjs": config(0),
  });
  const { loadConfig } = await import("../tinybuild/config.js");
  const app = await packager(
    await loadConfig("tinybuild.config.mjs", cwd, true),
    {
      cwd,
      configPath: "tinybuild.config.mjs",
      native: { dryRun: true },
      onError: (error) => errors.push(error),
    },
  );
  t.after(() => app.close());
  const original = app.server;
  for (const source of [config(0, "Changed"), config(8089)]) {
    const count = errors.length;
    await fs.writeFile(path.join(cwd, "tinybuild.config.mjs"), source);
    await until(() => errors.length > count);
    assert.match(errors.at(-1).message, /Restart tinybuild/);
    assert.equal(app.server, original);
    assert.equal((await request(app.server.SERVER)).status, 200);
  }
});

test("native address changes are also guarded while the launched SDK command is still running", async (t) => {
  const definition = (port) => ({
    bundler: {
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
    },
    server: { host: "127.0.0.1", port, delay: 30 },
    electron: { action: "open", liveReload: true },
  });
  const cwd = await fixture(t, {
    "index.js": "console.log(1);",
    "index.html": "app",
    "tinybuild.config.mjs": "export default " + JSON.stringify(definition(0)),
    "node_modules/electron/package.json":
      '{"name":"electron","main":"index.cjs"}',
    "node_modules/electron/index.cjs": "module.exports=process.execPath;",
  });
  let app,
    launched = false;
  const errors = [];
  const starting = packager(definition(0), {
    cwd,
    configPath: "tinybuild.config.mjs",
    onReady: (value) => (app = value),
    onError: (error) => errors.push(error),
    native: {
      run: async (args, { signal }) => {
        if (args[0] !== "electron") throw new Error("Unexpected SDK command");
        launched = true;
        await new Promise((resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("SDK cancelled")),
            { once: true },
          ),
        );
      },
    },
  });
  starting.catch(() => {});
  t.after(async () => {
    await app?.close();
    await starting.catch(() => {});
  });
  await until(() => launched);
  const original = app.server;
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default " + JSON.stringify(definition(8099)),
  );
  await until(() => errors.length);
  assert.match(errors.at(-1).message, /Restart tinybuild/);
  assert.equal(app.server, original);
  await app.close();
  await assert.rejects(starting, /SDK cancelled/);
});

test("native cleanup failures still dispose build contexts, server and owned tasks", async (t) => {
  const { cwd, app } = await appFixture(t);
  const url = app.server.url;
  app.native = {
    close: async () => {
      throw new Error("native cleanup failed");
    },
  };
  await assert.rejects(app.close(), /native cleanup failed/);
  assert.deepEqual(app.watcher.getWatched(), {});
  await assert.rejects(fetch(url));
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(10);");
  await delay(150);
  assert.equal(app.stats.builds, 1);
});

test("closing from onReady never announces a ready session after it has closed", async (t) => {
  const cwd = await fixture(t, { "index.js": "console.log(1);" });
  const events = [];
  await assert.rejects(
    packager(
      {
        bundler: {
          entryPoints: ["index.js"],
          outfile: "dist/index",
          autoInstall: false,
        },
        server: false,
      },
      {
        cwd,
        onReady: (app) => app.close(),
        onEvent: (event) => events.push(event.type),
      },
    ),
    /startup aborted/,
  );
  assert.equal(events.at(-1), "closed");
  assert.equal(events.includes("ready"), false);
});

test("closing while a restarted one-shot task is running stops it immediately", async (t) => {
  const cwd = await fixture(t, { "task.cjs": "console.log('first');" });
  const tasks = await startTasks(
    {
      prepare: {
        command: "node",
        args: ["task.cjs"],
        mode: "once",
        timeout: 10000,
      },
    },
    { cwd, silent: true, killTimeout: 100 },
  );
  t.after(() => tasks.close());
  await fs.writeFile(
    path.join(cwd, "task.cjs"),
    "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync('task-started',String(process.pid));setInterval(()=>{},1000);",
  );
  const restarting = tasks.restart("prepare");
  restarting.catch(() => {});
  await until(() =>
    fs.access(path.join(cwd, "task-started")).then(
      () => true,
      () => false,
    ),
  );
  const pid = Number(await fs.readFile(path.join(cwd, "task-started"), "utf8"));
  const start = Date.now();
  await tasks.close();
  await assert.rejects(restarting, /closed|failed|stopped/);
  assert.ok(Date.now() - start < 4000, "Do not wait for the one-shot timeout");
  assert.throws(() => process.kill(pid, 0));
});

test("desktop and mobile live reload reject a server configured for production before staging", async () => {
  assert.throws(
    () =>
      desktopDevelopment({
        server: { production: true },
        electron: { action: "open", liveReload: true },
      }),
    /development mode/,
  );
  const config = {
    server: { production: true },
    mobile: { android: { action: "run", liveReload: true } },
  };
  assert.throws(() => mobileDevelopment(config), /development mode/);
  await assert.rejects(
    packageNative(config, [], { dryRun: true }),
    /development mode/,
  );
});

test("native staging uses portable HTML with workers and keeps explicit runtime assets", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "import worker from './work.worker.js';new Worker(worker);",
    "work.worker.js": "onmessage=e=>postMessage(e.data);",
    "assets/data.json": '{"value":42}',
  });
  const config = {
    bundler: {
      entryPoints: ["index.js"],
      outfile: "dist/index",
      bundleHTML: true,
      autoInstall: false,
    },
    server: { startpage: "index.html" },
    assets: ["assets"],
  };
  const results = await bundle({ ...config.bundler, absWorkingDir: cwd });
  const native = await packageNative(
    {
      ...config,
      electron: { action: "stage" },
      tauri: { action: "stage" },
      mobile: { android: "stage" },
    },
    results,
    { cwd, dryRun: true },
  );
  for (const stage of Object.values(native.stages)) {
    assert.match(await fs.readFile(stage.html, "utf8"), /Worker/);
    assert.equal(
      await fs.readFile(path.join(stage.directory, "assets/data.json"), "utf8"),
      '{"value":42}',
    );
  }
  await native.close();
  await fs.writeFile(
    path.join(cwd, "index.html"),
    "<html>extra source page</html>",
  );
  await assert.rejects(
    packageNative(
      { ...config, assets: ["index.html"], electron: { action: "stage" } },
      results,
      { cwd, dryRun: true },
    ),
    /Two staged files map/,
  );
});

test("native staging honors production default roots and rejects private asset variants", async (t) => {
  const cwd = await fixture(t, {
    "dist/index.html": "<html>production</html>",
    "dist/index.js": "console.log(1);",
  });
  const config = {
    production: true,
    bundler: { outdir: "dist" },
    server: { startpage: "index.html" },
  };
  const stage = await stageWeb(config, [], "stage", { cwd });
  assert.match(await fs.readFile(stage.html, "utf8"), /production/);
  await fs.writeFile(
    path.join(cwd, "dist/deployment.env.local"),
    "SECRET=value",
  );
  await fs.writeFile(path.join(cwd, "dist/signing.p12"), "private");
  for (const asset of ["dist/deployment.env.local", "dist/signing.p12"])
    await assert.rejects(
      stageWeb(
        { ...config, assets: [asset] },
        [
          {
            config: { absWorkingDir: cwd },
            browser: { metafile: { outputs: { "dist/index.js": {} } } },
          },
        ],
        "stage",
        { cwd },
      ),
      /Private file/,
    );
});

test("production PWA files and cache URLs use the actual public root and stage with portable HTML", async (t) => {
  const cwd = await fixture(t, { "index.js": "console.log('offline app');" });
  const config = {
    build: true,
    production: true,
    bundler: {
      entryPoints: ["index.js"],
      outfile: "dist/index",
      bundleHTML: true,
      autoInstall: false,
    },
    server: { startpage: "index.html", pwa: "service-worker.js" },
    electron: { action: "stage" },
  };
  const app = await packager(config, { cwd });
  t.after(() => app.close());
  const server = await serve({
    ...config.server,
    cwd,
    production: true,
    host: "127.0.0.1",
    port: 0,
  });
  t.after(() => server.close());
  const response = await request(server.SERVER, "/service-worker.js");
  assert.equal(response.status, 200);
  assert.equal(response.headers["service-worker-allowed"], "/");
  assert.match(response.body, /"\/index.html"/);
  assert.doesNotMatch(response.body, /"\/dist\/index/);
  await fs.access(path.join(cwd, "electron/web/service-worker.js"));
  await assert.rejects(fs.access(path.join(cwd, "service-worker.js")));
});
