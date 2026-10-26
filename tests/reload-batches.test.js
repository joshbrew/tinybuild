import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import vm from "node:vm";
import { WebSocket } from "ws";
import { fixture, until, delay, request } from "./helpers.js";
import { packager } from "../tinybuild/packager.js";
import { runTinybuild } from "../tinybuild/cli.js";

test("multi-file save bursts publish one settled build, keep the server alive and serve newly added files", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "index.js":
      'import {a} from "./a.js";import {b} from "./b.js";console.log(a,b);',
    "a.js": "export const a=1;",
    "b.js": "export const b=1;",
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
  const original = app.server;
  const ws = new WebSocket(
    app.server.url.replace("http:", "ws:") + "/hotreload",
  );
  await once(ws, "open");
  t.after(() => ws.terminate());
  const messages = [];
  ws.on("message", (data) => messages.push(JSON.parse(data)));
  for (let i = 2; i <= 5; i++) {
    await fs.writeFile(path.join(cwd, "a.js"), "export const a=" + i + ";");
    await delay(20);
    await fs.writeFile(path.join(cwd, "b.js"), "export const b=" + i + ";");
  }
  await until(() => messages.some((message) => message.type === "built"));
  await delay(250);
  assert.equal(app.stats.builds, 2);
  assert.equal(
    messages.filter((message) => message.type === "built").length,
    1,
  );
  assert.equal(app.server, original);
  await fs.writeFile(path.join(cwd, "fresh.txt"), "new file");
  assert.equal(
    (await request(app.server.SERVER, "/fresh.txt")).body,
    "new file",
  );
  assert.match(
    (await request(app.server.SERVER, "/dist/index.js")).body,
    /a = 5/,
  );
});

for (const mode of ["simultaneous", "staggered"]) {
  test(`ten ${mode} file saves produce one rebuild and one live-server update`, async (t) => {
    const files = { "index.html": '<script src="dist/index.js"></script>' };
    files["index.js"] =
      Array.from(
        { length: 10 },
        (_, i) => `import {value as value${i}} from './part-${i}.js';`,
      ).join("\n") +
      "\nglobalThis.batchTotal=" +
      Array.from({ length: 10 }, (_, i) => `value${i}`).join("+") +
      ";";
    for (let i = 0; i < 10; i++)
      files[`part-${i}.js`] = `export const value=${i};`;
    const cwd = await fixture(t, files);
    const app = await packager(
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
    t.after(() => app.close());
    const original = app.server;
    const socket = new WebSocket(
      app.server.url.replace("http:", "ws:") + "/hotreload",
    );
    t.after(() => socket.terminate());
    await once(socket, "open");
    const messages = [];
    socket.on("message", (data) => messages.push(JSON.parse(data)));
    if (mode === "simultaneous") {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          fs.writeFile(
            path.join(cwd, `part-${i}.js`),
            `export const value=${100 + i};`,
          ),
        ),
      );
    } else {
      for (let i = 0; i < 10; i++) {
        await fs.writeFile(
          path.join(cwd, `part-${i}.js`),
          `export const value=${100 + i};`,
        );
        await delay(20);
      }
    }
    await until(() => messages.some((message) => message.type === "built"));
    await delay(350);
    assert.equal(
      app.stats.builds,
      2,
      "One initial build plus one rebuild for all ten files",
    );
    assert.equal(
      messages.filter((message) => message.type === "built").length,
      1,
    );
    assert.equal(app.server, original, "Keep the same listening server");
    const output = await request(app.server.SERVER, "/dist/index.js");
    assert.equal(output.status, 200);
    const context = {};
    vm.runInNewContext(output.body, context);
    assert.equal(context.batchTotal, 1045, "Serve all ten updated values");
    assert.equal(
      (await request(app.server.SERVER, "/_tinybuild/ready")).status,
      200,
    );
  });
}

test("saves during an active build publish the final outputs once and recover from an intermediate syntax error", async (t) => {
  let app, release;
  t.after(() => {
    release?.();
    return app?.close();
  });
  const cwd = await fixture(t, {
    "index.js": "console.log(1);",
    "index.html": '<script src="dist/index.js"></script>',
  });
  let blocked = false,
    slow = false;
  let active = 0,
    maximumActive = 0;
  const reported = [];
  const plugin = {
    name: "slow-test",
    setup(build) {
      build.onStart(async () => {
        maximumActive = Math.max(maximumActive, ++active);
        if (slow) {
          slow = false;
          blocked = true;
          await new Promise((resolve) => (release = resolve));
        }
      });
      build.onEnd(() => {
        active--;
      });
    },
  };
  app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
        plugins: [plugin],
        logLevel: "silent",
      },
      server: { host: "127.0.0.1", port: 0, delay: 100 },
    },
    { cwd, onError: (error) => reported.push(error) },
  );
  const ws = new WebSocket(
    app.server.url.replace("http:", "ws:") + "/hotreload",
  );
  await once(ws, "open");
  t.after(() => ws.terminate());
  const messages = [];
  ws.on("message", (data) => messages.push(JSON.parse(data)));
  slow = true;
  const manual = app.rebuild();
  await until(() => blocked);
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(42);");
  await delay(250);
  release();
  await manual;
  await until(() => app.stats.builds === 3);
  await until(() =>
    messages.some((message) => message.files?.includes("/dist/index.js")),
  );
  assert.equal(
    messages.filter((message) => message.type === "built").length,
    1,
  );
  await fs.writeFile(path.join(cwd, "index.js"), "const = ;");
  await until(() => messages.some((message) => message.type === "error"));
  await delay(80);
  assert.equal(reported.length, 1, "One callback per failed build");
  assert.equal(
    messages.filter((message) => message.type === "error").length,
    1,
  );
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(43);");
  await until(() => app.stats.builds === 4);
  assert.equal(
    maximumActive,
    1,
    "Builds must never overlap, including during error recovery",
  );
  assert.equal(active, 0);
  assert.equal((await request(app.server.SERVER)).status, 200);
});

test("CLI reports the live URL after startup completion and after subsequent successful builds", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "tinybuild.config.mjs":
      'export default {bundler:{entryPoints:["index.js"],outfile:"dist/index",autoInstall:false},server:{host:"127.0.0.1",port:0}};',
    "index.js": "console.log(1);",
    "index.html": "hello",
  });
  const lines = [];
  const original = console.log;
  console.log = (...values) => lines.push(values.join(" "));
  t.after(() => (console.log = original));
  app = await runTinybuild([], {
    cwd,
    onReady: () => console.log("package startup finished"),
    onBuild: () => console.log("package build finished"),
  });
  assert.equal(lines.at(-1), "Tinybuild listening at " + app.server.url);
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(2);");
  await until(() => app.stats.builds === 2);
  await delay(20);
  assert.equal(lines.at(-1), "Tinybuild listening at " + app.server.url);
  assert.equal(lines.at(-2), "package build finished");
});

test("task restart bursts coalesce into a single replacement for the same dependency graph", async (t) => {
  let tasks;
  t.after(() => tasks?.close());
  const { startTasks } = await import("../tinybuild/tasks.js");
  const cwd = await fixture(t, {
    "api.js": 'console.log("READY");setInterval(()=>{},10000);',
  });
  const events = [];
  tasks = await startTasks(
    { api: { command: "node", args: ["api.js"], ready: { stdout: "READY" } } },
    { cwd, silent: true, onEvent: (event) => events.push(event) },
  );
  await Promise.all(Array.from({ length: 10 }, () => tasks.restart("api")));
  assert.equal(events.filter((event) => event.state === "starting").length, 2);
  assert.equal(tasks.status.api.state, "ready");
  await tasks.close();
});

test("copied asset additions and generated PWA/report files do not cause missed copies or rebuild loops", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "index.js": "console.log(1);",
    "index.html": "hello",
    "public/a.svg": "<svg/>",
  });
  app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
      },
      copy: [{ from: "public", to: "dist/static" }],
      diagnostics: { report: "build-report.html" },
      server: { host: "127.0.0.1", port: 0, pwa: "service-worker.js" },
    },
    { cwd },
  );
  await fs.writeFile(path.join(cwd, "public/new.svg"), "<svg>new</svg>");
  await until(() => app.stats.builds === 2);
  assert.equal(
    await fs.readFile(path.join(cwd, "dist/static/new.svg"), "utf8"),
    "<svg>new</svg>",
  );
  await delay(500);
  assert.equal(app.stats.builds, 2);
  await fs.unlink(path.join(cwd, "public/new.svg"));
  await until(() => app.stats.builds === 3);
  await assert.rejects(fs.access(path.join(cwd, "dist/static/new.svg")));
});
