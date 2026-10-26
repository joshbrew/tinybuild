import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { packager } from "../tinybuild/packager.js";
import { runTinybuild } from "../tinybuild/cli.js";
import { startTasks } from "../tinybuild/tasks.js";
import { fixture, until, delay, request } from "./helpers.js";

async function developmentApp(t, server = {}, files = {}) {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "index.js": 'import {a} from "./a.js";console.log(a);',
    "a.js": "export const a=1;",
    "index.html": '<script src="dist/index.js"></script>',
    ...files,
  });
  const starts = [],
    changes = [],
    builds = [];
  app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
        plugins: [
          {
            name: "observe-start",
            setup(build) {
              build.onStart(() => {
                starts.push(performance.now());
              });
            },
          },
        ],
      },
      server: { host: "127.0.0.1", port: 0, ...server },
    },
    { cwd, onBuild: (stats) => builds.push(stats) },
  );
  app.watcher.on("all", (event, filename) => {
    changes.push({
      event,
      filename: path.resolve(filename),
      time: performance.now(),
    });
  });
  async function edit(filename, contents) {
    const absolute = path.join(cwd, filename);
    const previous = changes.length;
    await fs.writeFile(absolute, contents);
    await until(() =>
      changes.slice(previous).some((change) => change.filename === absolute),
    );
    return changes
      .slice(previous)
      .find((change) => change.filename === absolute);
  }
  return { app, cwd, starts, changes, builds, edit };
}

async function reloadMessages(t, app) {
  const socket = new WebSocket(
    app.server.url.replace("http:", "ws:") + "/hotreload",
  );
  t.after(() => socket.terminate());
  await once(socket, "open");
  const messages = [];
  socket.on("message", (data) => messages.push(JSON.parse(data)));
  return messages;
}

for (const configured of [undefined, 0, 320]) {
  test(`saved edits honor ${configured === undefined ? "the default 150 ms delay" : `delay: ${configured}`}`, async (t) => {
    const expected = configured ?? 150;
    const { app, starts, builds, edit } = await developmentApp(
      t,
      configured === undefined ? {} : { delay: configured },
    );
    const scheduled = [];
    const realTimeout = globalThis.setTimeout;
    const timer = t.mock.method(
      globalThis,
      "setTimeout",
      (callback, ms, ...args) => {
        scheduled.push(ms);
        return realTimeout(callback, ms, ...args);
      },
    );
    const change = await edit("a.js", "export const a=2;");
    await until(() => builds.length === 2);
    timer.mock.restore();
    assert.ok(
      scheduled.includes(expected),
      `Schedule the configured ${expected} ms, including zero`,
    );
    assert.ok(
      starts[1] - change.time >= expected - 10,
      "Do not rebuild before the quiet window expires",
    );
    assert.equal(app.stats.builds, 2);
    assert.match(
      (await request(app.server.SERVER, "/dist/index.js")).body,
      /a = 2/,
    );
  });
}

test("each new file edit resets the quiet window and publishes one final browser update", async (t) => {
  const { app, starts, builds, edit } = await developmentApp(t, { delay: 320 });
  const original = app.server;
  const messages = await reloadMessages(t, app);
  await edit("a.js", "export const a=2;");
  const last = await edit(
    "index.js",
    'import {a} from "./a.js";console.log("final",a);',
  );
  await until(() => messages.some((message) => message.type === "built"));
  assert.ok(
    starts[1] - last.time >= 310,
    "Restart the full delay after the last edit",
  );
  await delay(450);
  assert.equal(builds.length, 2);
  assert.equal(
    messages.filter((message) => message.type === "built").length,
    1,
  );
  assert.equal(app.server, original);
  assert.match(
    (await request(app.server.SERVER, "/dist/index.js")).body,
    /final/,
  );
});

test("HTML and image edits use the same delay without doing a JavaScript rebuild", async (t) => {
  const { app, starts, edit } = await developmentApp(
    t,
    { delay: 260 },
    { "icon.svg": "<svg/>" },
  );
  const messages = await reloadMessages(t, app);
  const received = [];
  const originalBroadcast = app.server.SOCKETS.hotreload.broadcast.bind(
    app.server.SOCKETS.hotreload,
  );
  t.mock.method(app.server.SOCKETS.hotreload, "broadcast", (message) => {
    received.push(performance.now());
    return originalBroadcast(message);
  });
  await edit("index.html", "<h1>Updated page</h1>");
  const last = await edit("icon.svg", "<svg>updated</svg>");
  await until(() => messages.some((message) => message.type === "built"));
  assert.ok(received[0] - last.time >= 250);
  assert.deepEqual(messages[0].files.sort(), ["/icon.svg", "/index.html"]);
  assert.equal(starts.length, 1);
  assert.equal(app.stats.builds, 1);
  assert.match((await request(app.server.SERVER)).body, /Updated page/);
});

test("ignore and extensions filter real saved edits before they reach the rebuild queue", async (t) => {
  const { app, cwd, builds, edit } = await developmentApp(
    t,
    {
      delay: 80,
      ignore: ["generated"],
      extensions: ["js", "html"],
    },
    { "generated/ignored.js": "console.log(1);", "notes.txt": "one" },
  );
  const messages = await reloadMessages(t, app);
  await fs.writeFile(path.join(cwd, "generated/ignored.js"), "console.log(2);");
  await fs.writeFile(path.join(cwd, "notes.txt"), "two");
  await delay(400);
  assert.equal(builds.length, 1);
  assert.equal(messages.length, 0);
  await edit("a.js", "export const a=3;");
  await until(() => builds.length === 2);
  assert.deepEqual(builds.at(-1).reason.files, ["a.js"]);
  assert.match(
    (await request(app.server.SERVER, "/dist/index.js")).body,
    /a = 3/,
  );
});

test("closing during the quiet window cancels the queued rebuild", async (t) => {
  const { app, builds, edit } = await developmentApp(t, { delay: 320 });
  await edit("a.js", "export const a=4;");
  await app.close();
  await delay(450);
  assert.equal(builds.length, 1);
  assert.equal(app.stats.builds, 1);
  assert.deepEqual(app.watcher.getWatched(), {});
});

test("editing delay in the config changes the timing of subsequent saved edits", async (t) => {
  let app;
  t.after(() => app?.close());
  const config = (delay) =>
    `export default {bundler:{entryPoints:["index.js"],outfile:"dist/index",autoInstall:false},server:{host:"127.0.0.1",port:0,delay:${delay}}};`;
  const cwd = await fixture(t, {
    "tinybuild.config.mjs": config(20),
    "index.js": "console.log(1);",
    "index.html": "hello",
  });
  const builds = [];
  app = await runTinybuild([], {
    cwd,
    onBuild: () => builds.push(performance.now()),
  });
  const port = app.server.port;
  await fs.writeFile(path.join(cwd, "tinybuild.config.mjs"), config(320));
  await until(() => builds.length === 2);
  let changed;
  app.watcher.on("all", (event, filename) => {
    if (path.basename(filename) === "index.js") changed = performance.now();
  });
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(2);");
  await until(() => builds.length === 3);
  assert.ok(builds[2] - changed >= 310);
  assert.equal(app.server.port, port);
  assert.match(
    (await request(app.server.SERVER, "/dist/index.js")).body,
    /console.log\(2\)/,
  );
});

test("task delay batches saved edits into one restart and closing cancels a pending restart", async (t) => {
  let tasks;
  t.after(() => tasks?.close());
  const cwd = await fixture(t, { "trigger.txt": "one" });
  const events = [];
  tasks = await startTasks(
    {
      api: {
        command: "node",
        args: ["-e", 'console.log("READY");setInterval(()=>{},10000)'],
        ready: { stdout: "READY" },
        watch: ["trigger.txt"],
        delay: 320,
      },
    },
    {
      cwd,
      silent: true,
      onEvent: (event) => events.push({ ...event, time: performance.now() }),
    },
  );
  let lastWrite;
  for (let i = 0; i < 3; i++) {
    lastWrite = performance.now();
    await fs.writeFile(path.join(cwd, "trigger.txt"), String(i));
    await delay(90);
  }
  await until(
    () => events.filter((event) => event.state === "ready").length === 2,
  );
  assert.ok(
    events.filter((event) => event.state === "starting")[1].time - lastWrite >=
      300,
  );
  await delay(450);
  assert.equal(events.filter((event) => event.state === "starting").length, 2);
  await fs.writeFile(path.join(cwd, "trigger.txt"), "cancel this restart");
  await delay(120);
  await tasks.close();
  await delay(450);
  assert.equal(events.filter((event) => event.state === "starting").length, 2);
});
