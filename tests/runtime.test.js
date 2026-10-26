import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter, once } from "node:events";
import vm from "node:vm";
import WebSocket from "ws";
import { packager } from "../tinybuild/packager.js";
import { runAndWatch, isWatchedFile } from "../tinybuild/repo.js";
import {
  HotReloadClient,
  addHotReloadClient,
} from "../tinybuild/node_server/hotreload/hotreload.js";
import { fixture, delay, until } from "./helpers.js";

test("supervisor coalesces burst changes and closes its watcher and child", async () => {
  const children = [];
  let watch;
  const spawn = () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = () => {
      setTimeout(() => {
        child.exitCode = 0;
        child.emit("exit", 0);
      }, 10);
    };
    children.push(child);
    return child;
  };
  const supervisor = runAndWatch("script.js", [], [], [], 5, {
    spawn,
    watch: () => {
      watch = new EventEmitter();
      watch.close = async () => {
        watch.closed = true;
      };
      return watch;
    },
  });
  supervisor.restart("a.js");
  supervisor.restart("b.js");
  await delay(50);
  assert.equal(children.length, 2);
  watch.emit("all", "add", "c.js");
  watch.emit("all", "unlink", "d.js");
  await delay(50);
  assert.equal(children.length, 3);
  await supervisor.close();
  assert.equal(watch.closed, true);
  assert.equal(children.at(-1).exitCode, 0);
});
test("watch filtering uses directory boundaries and exact extensions", () => {
  const options = { cwd: "/project", ignore: ["dist"], extensions: ["js"] };
  assert.equal(isWatchedFile("/project/dist/index.js", options), false);
  assert.equal(isWatchedFile("/project/distance.js", options), true);
  assert.equal(
    isWatchedFile("/project/.tinybuild-config-temporary.cjs", {
      ...options,
      extensions: ["cjs"],
    }),
    false,
  );
  assert.equal(
    isWatchedFile("/project/.tinybuild-config-temporary.mjs", {
      ...options,
      extensions: ["mjs"],
    }),
    false,
  );
  assert.equal(isWatchedFile("/project/file.json", options), false);
  assert.equal(isWatchedFile("/other/index.js", options), false);
  assert.equal(isWatchedFile("/", options), false);
  assert.equal(
    isWatchedFile("/shared/index.js", {
      ...options,
      watchPaths: ["../shared"],
    }),
    true,
  );
  assert.equal(
    isWatchedFile("/project/node_modules/a/index.js", options),
    false,
  );
});
test("browser client versions CSS, preserves old link until loaded, shows errors, and reloads JS", () => {
  let socket,
    next,
    overlay,
    reloaded = 0;
  const link = {
    href: "http://localhost/dist/index.css?old=1",
    cloneNode: () => (next = {}),
    after: () => {},
    remove: () => {
      link.removed = true;
    },
  };
  const context = {
    URL,
    location: {
      href: "http://localhost/",
      protocol: "http:",
      reload: () => reloaded++,
    },
    WebSocket: class {
      constructor(url) {
        socket = this;
        this.url = url;
        this.handlers = {};
      }
      addEventListener(name, fn) {
        this.handlers[name] = fn;
      }
      close() {}
    },
    document: {
      getElementById: () => overlay,
      createElement: () =>
        (overlay = {
          style: {},
          remove() {
            overlay = undefined;
          },
        }),
      body: { append() {} },
      querySelectorAll: () => [link],
    },
    addEventListener() {},
    setTimeout,
    clearTimeout,
    Date,
  };
  vm.runInNewContext(
    "(" + HotReloadClient.toString() + ')("/hotreload")',
    context,
  );
  assert.equal(socket.url, "ws://localhost/hotreload");
  socket.handlers.message({
    data: JSON.stringify({ type: "built", files: ["/dist/index.css"] }),
  });
  assert.match(next.href, /__tinybuild=/);
  assert.equal(link.removed, undefined);
  next.onload();
  assert.equal(link.removed, true);
  socket.handlers.message({
    data: JSON.stringify({ type: "error", message: "broken" }),
  });
  assert.equal(overlay.textContent, "broken");
  socket.handlers.message({
    data: JSON.stringify({ type: "built", files: ["/dist/index.js"] }),
  });
  assert.equal(overlay, undefined);
  assert.equal(reloaded, 1);
  assert.doesNotMatch(
    addHotReloadClient("html", "</script>"),
    /\("<\/script>"\)/,
  );
});
test("development rebuilds CSS, handles add/delete, reports errors and recovers without replacing HTTP server", async (t) => {
  let app;
  t.after(() => app?.close());
  const root = await fixture(t, {
    "index.js": 'import "./index.css"; console.log(1);',
    "index.css": "body{color:red}",
    "index.html":
      '<link rel="stylesheet" href="/dist/index.css"><script src="/dist/index.js"></script>',
  });
  app = await packager({
    bundler: {
      absWorkingDir: root,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
      logLevel: "silent",
    },
    server: { host: "127.0.0.1", port: 0, hotreload: true, delay: 10 },
  });
  const identity = app.server.SERVER;
  const socket = new WebSocket(
    app.server.url.replace("http:", "ws:") + "/hotreload",
  );
  t.after(() => socket.terminate());
  await once(socket, "open");
  const messages = [];
  socket.on("message", (data) => messages.push(JSON.parse(data)));
  await fs.writeFile(path.join(root, "index.css"), "body{color:green}");
  await until(() =>
    messages.some(
      (message) =>
        message.type === "built" && message.files.includes("/dist/index.css"),
    ),
  );
  assert.match(
    await fs.readFile(path.join(root, "dist/index.css"), "utf8"),
    /green/,
  );
  await fs.writeFile(path.join(root, "index.js"), "invalid !! javascript");
  await until(() => messages.some((message) => message.type === "error"));
  await fs.writeFile(path.join(root, "extra.js"), "export const value=2;");
  await fs.writeFile(
    path.join(root, "index.js"),
    'import {value} from "./extra.js"; console.log(value);',
  );
  await until(
    () => messages.filter((message) => message.type === "built").length >= 2,
  );
  assert.equal(app.server.SERVER, identity);
  await fs.unlink(path.join(root, "extra.js"));
  await until(
    () => messages.filter((message) => message.type === "error").length >= 2,
  );
});
test("one-shot packager is reusable and never exits its caller", async (t) => {
  const root = await fixture(t, { "index.js": "export const a=1;" });
  const app = await packager({
    build: true,
    bundler: {
      absWorkingDir: root,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      includeDefaultPlugins: false,
    },
    server: false,
  });
  assert.ok(app.bundles[0].browser);
  await app.close();
});

test("configuration changes recreate build options and settle without output-watch loops", async (t) => {
  let app;
  t.after(() => app?.close());
  const root = await fixture(t, {
    "index.js": "console.log(LABEL);",
    "index.html": '<script src="/dist/index.js"></script>',
    "tinybuild.config.mjs":
      'export default {bundler:{entryPoints:["index.js"],outfile:"dist/index",autoInstall:false,define:{LABEL:"1"}},server:{host:"127.0.0.1",port:0,hotreload:true,delay:10}};',
  });
  const { runTinybuild } = await import("../tinybuild/cli.js");
  app = await runTinybuild([], { cwd: root });
  await fs.writeFile(
    path.join(root, "tinybuild.config.mjs"),
    'export default {bundler:{entryPoints:["index.js"],outfile:"output/index",autoInstall:false,define:{LABEL:"2"}},server:{host:"127.0.0.1",port:0,hotreload:true,delay:10}};',
  );
  await until(async () =>
    (
      await fs
        .readFile(path.join(root, "output/index.js"), "utf8")
        .catch(() => "")
    ).includes("2"),
  );
  const stat = await fs.stat(path.join(root, "output/index.js"));
  await delay(300);
  assert.equal(
    (await fs.stat(path.join(root, "output/index.js"))).mtimeMs,
    stat.mtimeMs,
  );
});
test("an initial build failure keeps development serving and recovers on the next edit", async (t) => {
  let app;
  t.after(() => app?.close());
  const root = await fixture(t, {
    "index.js": "invalid !! syntax",
    "index.html": "<h1>Recovery</h1>",
  });
  app = await packager({
    bundler: {
      absWorkingDir: root,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
      logLevel: "silent",
    },
    server: { host: "127.0.0.1", port: 0, hotreload: true },
  });
  assert.ok(app.server.SOCKETS.hotreload.lastError);
  await fs.writeFile(path.join(root, "index.js"), 'console.log("recovered");');
  await until(() => !app.server.SOCKETS.hotreload.lastError);
  assert.match(
    await fs.readFile(path.join(root, "dist/index.js"), "utf8"),
    /recovered/,
  );
});

test("imported image and HTML assets rebuild while plain static assets notify directly", async (t) => {
  let app;
  t.after(() => app?.close());
  const root = await fixture(t, {
    "index.js":
      'import image from "./pixel.png"; import html from "./view.html"; console.log(image,html);',
    "pixel.png": "image one",
    "view.html": "<p>one</p>",
    "index.html": '<script src="/dist/index.js"></script>',
  });
  app = await packager({
    bundler: {
      absWorkingDir: root,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
    },
    server: { host: "127.0.0.1", port: 0, hotreload: true },
  });
  const originalImage = (await fs.readdir(path.join(root, "dist"))).find(
    (file) => file.endsWith(".png"),
  );
  await fs.writeFile(path.join(root, "pixel.png"), "image two");
  await until(async () =>
    (await fs.readdir(path.join(root, "dist"))).some(
      (file) => file.endsWith(".png") && file !== originalImage,
    ),
  );
  await fs.writeFile(path.join(root, "view.html"), "<p>two</p>");
  await until(async () =>
    (await fs.readFile(path.join(root, "dist/index.js"), "utf8")).includes(
      "<p>two</p>",
    ),
  );
});
test("Python supervision filters Python edits and passes the owned child environment", async () => {
  let watcher, child, invocation;
  const supervisor = runAndWatch("python/server.py", [], ["dist"], ["py"], 5, {
    command: "python",
    env: { TINYBUILD_ROOT: "fixture" },
    spawn: (...args) => {
      invocation = args;
      child = new EventEmitter();
      child.exitCode = null;
      child.kill = () => {
        child.exitCode = 0;
        child.emit("exit", 0);
      };
      return child;
    },
    watch: () => {
      watcher = new EventEmitter();
      watcher.close = async () => {};
      return watcher;
    },
  });
  assert.equal(invocation[0], "python");
  assert.equal(invocation[2].env.TINYBUILD_ROOT, "fixture");
  watcher.emit("all", "change", "index.js");
  await delay(20);
  assert.equal(supervisor.process, child);
  await supervisor.close();
});

test("runOnChange accepts generic commands and serializes changes without an initial spawn", async () => {
  const { runOnChange } = await import("../tinybuild/repo.js");
  let watcher;
  const children = [];
  const commands = [];
  const result = runOnChange("custom-tool", ["build"], [], ["js"], {
    delay: 5,
    watch: () => {
      watcher = new EventEmitter();
      watcher.close = async () => {};
      return watcher;
    },
    spawn: (...args) => {
      commands.push(args);
      const child = new EventEmitter();
      child.exitCode = null;
      child.kill = () => {
        child.exitCode = 0;
        child.emit("exit", 0);
      };
      children.push(child);
      return child;
    },
  });
  assert.equal(children.length, 0);
  watcher.emit("all", "change", "index.js");
  await delay(15);
  assert.equal(children.length, 1);
  watcher.emit("all", "add", "other.js");
  watcher.emit("all", "unlink", "gone.js");
  await delay(15);
  assert.equal(children.length, 1);
  children[0].exitCode = 0;
  children[0].emit("exit", 0);
  await delay(15);
  assert.equal(children.length, 2);
  assert.equal(commands[0][0], "custom-tool");
  assert.deepEqual(commands[0][1], ["build"]);
  await result.close();
});

test("CLI honors a local custom tinybuild script when no config is present", async (t) => {
  let app;
  t.after(() => app?.close());
  const root = await fixture(t, {
    "package.json": '{"type":"module"}',
    "tinybuild.js":
      'import fs from "node:fs";fs.writeFileSync("started.txt","yes");setInterval(()=>{},1000);',
  });
  const { runTinybuild } = await import("../tinybuild/cli.js");
  app = await runTinybuild(["ignore=started.txt"], { cwd: root });
  await app.ready;
  assert.ok(Object.keys(app.watcher.getWatched()).length);
  await until(() =>
    fs.access(path.join(root, "started.txt")).then(
      () => true,
      () => false,
    ),
  );
  assert.ok(app.process.pid);
  await app.close();
  assert.deepEqual(app.watcher.getWatched(), {});
  assert.ok(app.process.exitCode !== null || app.process.signalCode);
});
