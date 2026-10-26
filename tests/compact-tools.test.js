import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { doctorReport } from "../tinybuild/doctor.js";
import { packager } from "../tinybuild/packager.js";
import { packageNative } from "../tinybuild/native.js";
import { runTinybuild } from "../tinybuild/cli.js";
import { terminateChild } from "../tinybuild/process.js";
import { fixture, until, delay } from "./helpers.js";
const execute = promisify(execFile);
const cli = fileURLToPath(
  new URL("../tinybuild/bin/global.js", import.meta.url),
);

test("support reports select useful settings, redact paths and URLs, and omit arbitrary config secrets", async (t) => {
  const cwd = await fixture(t);
  const secret = "do-not-share-123";
  const config = {
    metadata: { ordinary: secret },
    native: { env: { API_KEY: secret } },
    bundler: {
      entryPoints: [
        "https://user:" +
          secret +
          "@example.com/source.js?key=" +
          secret +
          "#" +
          secret,
      ],
      outfile: path.join(cwd, "dist/index"),
      define: { PUBLIC: JSON.stringify(secret) },
      banner: { js: secret },
      autoInstall: false,
    },
    server: {
      host: "localhost",
      port: 8765,
      headers: { ordinary: secret },
      routes: { "/private": { template: secret } },
    },
    tasks: { api: { command: "node", args: [secret], env: { VALUE: secret } } },
  };
  const before = JSON.stringify(config);
  const result = doctorReport(config, { cwd });
  const text = JSON.stringify(result);
  assert.equal(result.ok, true);
  assert.ok(result.runtime.esbuild);
  assert.equal(result.project.server.port, 8765);
  assert.deepEqual(result.project.tasks, ["api"]);
  assert.match(text, /<project>/);
  assert.match(text, /redacted/);
  assert.ok(!text.includes(secret));
  assert.ok(!text.includes(cwd));
  assert.equal(JSON.stringify(config), before);
  assert.deepEqual(await fs.readdir(cwd), []);
});

test("doctor report CLI stays read-only and emits a safe failed result for config load errors", async (t) => {
  const cwd = await fixture(t);
  const { stdout } = await execute(
    process.execPath,
    [cli, "doctor", "--report", "--json"],
    { cwd },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.command, "doctor");
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(await fs.readdir(cwd), []);
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "throw Error('private-credential');",
  );
  await assert.rejects(
    execute(process.execPath, [cli, "doctor", "--report", "--json"], { cwd }),
    (error) => {
      assert.equal(error.code, 1);
      const record = JSON.parse(error.stdout);
      assert.equal(record.ok, false);
      assert.match(record.data.configurationError, /validate/);
      assert.ok(!(error.stdout + error.stderr).includes("private-credential"));
      return true;
    },
  );
  assert.deepEqual(await fs.readdir(cwd), ["tinybuild.config.mjs"]);
});

test("agent command contracts keep checks and build failures machine-readable with nonzero exits", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "console.log(42)",
    "index.html": "<html>hello</html>",
    "tinybuild.config.mjs":
      "export default {bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false},server:{host:'127.0.0.1',port:0},checks:{files:['dist/index.js'],urls:[{path:'/',includes:'hello'}]}};",
  });
  const checked = JSON.parse(
    (await execute(process.execPath, [cli, "check", "--json"], { cwd })).stdout,
  );
  assert.equal(checked.command, "check");
  assert.equal(checked.ok, true);
  assert.equal(checked.data.steps.length, 3);
  await fs.writeFile(path.join(cwd, "index.html"), "<html>wrong</html>");
  await assert.rejects(
    execute(process.execPath, [cli, "check", "--json"], { cwd }),
    (error) => {
      const record = JSON.parse(error.stdout);
      assert.equal(error.code, 1);
      assert.equal(record.command, "check");
      assert.equal(record.schemaVersion, 1);
      assert.equal(record.ok, false);
      assert.match(record.error.message, /missing expected text/);
      return true;
    },
  );
  await fs.writeFile(path.join(cwd, "index.js"), "invalid syntax !!!");
  await assert.rejects(
    execute(process.execPath, [cli, "build", "--json"], { cwd }),
    (error) => {
      const records = error.stdout.trim().split(/\r?\n/).map(JSON.parse);
      assert.equal(error.code, 1);
      assert.deepEqual(
        records.filter((record) => record.type).map((record) => record.type),
        ["building", "build-error", "closed"],
      );
      assert.equal(records.at(-1).command, "build");
      assert.equal(records.at(-1).ok, false);
      return true;
    },
  );
});

test("live CLI JSON survives grouped saves, build errors, recovery and graceful cancellation", async (t) => {
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.send("stop");
      const timeout = setTimeout(() => child.kill(), 3000);
      try {
        await exited;
      } finally {
        clearTimeout(timeout);
      }
    }
  });
  const cwd = await fixture(t, {
    "index.js": "import {value} from './value.js';console.log(value);",
    "value.js": "export const value=1;",
    "index.html": '<script src="dist/index.js"></script>',
    "tinybuild.config.mjs":
      "export default {bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false},server:{host:'127.0.0.1',port:0,delay:100}};",
  });
  const source = `import {main} from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../tinybuild/cli.js", import.meta.url))).href)};process.on('message',()=>{process.disconnect();process.emit('SIGTERM')});await main(['dev','--debug','--json']);`;
  const records = [];
  let buffered = "",
    stderr = "",
    parseError;
  child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop();
    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch (error) {
        parseError = error;
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  await until(() => records.some((event) => event.type === "ready"));
  const url = records.find((event) => event.type === "ready").url;
  await Promise.all([
    fs.writeFile(
      path.join(cwd, "index.js"),
      "import {value} from './value.js';console.log(value+1);",
    ),
    fs.writeFile(path.join(cwd, "value.js"), "export const value=2;"),
  ]);
  await until(
    () => records.filter((event) => event.type === "built").length === 2,
  );
  const batch = records.find(
    (event) => event.type === "reload" && event.action === "batch",
  );
  assert.deepEqual(batch.files.sort(), ["index.js", "value.js"]);
  assert.equal(batch.delay, 100);
  assert.equal(records.findLast((event) => event.type === "built").url, url);
  await fs.writeFile(path.join(cwd, "index.js"), "bad syntax !!!");
  await until(() => records.some((event) => event.type === "build-error"));
  assert.equal((await fetch(url + "/_tinybuild/ready")).status, 503);
  await fs.writeFile(path.join(cwd, "index.js"), "console.log('recovered');");
  await until(
    () => records.filter((event) => event.type === "built").length === 3,
  );
  assert.equal((await fetch(url + "/_tinybuild/ready")).status, 200);
  const exited = once(child, "exit");
  child.send("stop");
  const [code] = await exited;
  assert.equal(code, 0, stderr);
  assert.equal(parseError, undefined);
  assert.equal(buffered, "");
  assert.equal(records.at(-1).type, "closed");
  assert.deepEqual(
    records.map((event) => event.sequence),
    records.map((_, index) => index + 1),
  );
  for (const event of records) assert.equal(event.schemaVersion, 1);
  assert.match(stderr, /Reload: Grouped 2/);
  await assert.rejects(fetch(url));
});

test("standalone watched Electron stays open without a web server and closes its process on shutdown", async (t) => {
  let child;
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    if (child.connected) child.send("stop");
    const timeout = setTimeout(() => terminateChild(child), 3000);
    try {
      await exited;
    } finally {
      clearTimeout(timeout);
    }
  };
  t.after(stop);
  const cwd = await fixture(t, {
    "index.js": "console.log('renderer');",
    "index.html": '<script src="dist/index.js"></script>',
    "tinybuild.config.mjs":
      "export default {bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false},server:false,electron:{action:'open',directory:'shell',watch:true,liveReload:false}};",
    // Run a portable child through the real Electron supervisor without a GUI or SDK.
    "node_modules/electron/package.json":
      '{"name":"electron","main":"index.cjs","version":"44.8.0"}',
    "node_modules/electron/index.cjs": "module.exports=process.execPath;",
    "shell/package.json": '{"main":"main.cjs"}',
    "shell/main.cjs":
      "console.error('SHELL_PID='+process.pid);setInterval(()=>{},1000);",
  });
  const source = `import {main} from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../tinybuild/cli.js", import.meta.url))).href)};process.on('message',()=>{process.disconnect();process.emit('SIGTERM')});await main([]);`;
  let stderr = "";
  child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  await until(() => /SHELL_PID=\d+/.test(stderr) || child.exitCode !== null);
  assert.match(stderr, /SHELL_PID=\d+/);
  const pid = Number(stderr.match(/SHELL_PID=(\d+)/)[1]);
  await delay(300);
  assert.equal(
    child.exitCode,
    null,
    "The CLI must keep the native supervisor alive",
  );
  assert.doesNotThrow(() => process.kill(pid, 0));
  await fs.appendFile(path.join(cwd, "shell/main.cjs"), "\n// saved\n");
  await until(() => [...stderr.matchAll(/SHELL_PID=(\d+)/g)].length === 2);
  const relaunched = Number([...stderr.matchAll(/SHELL_PID=(\d+)/g)].at(-1)[1]);
  assert.notEqual(relaunched, pid);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.doesNotThrow(() => process.kill(relaunched, 0));
  await stop();
  assert.equal(child.exitCode, 0, stderr);
  assert.throws(() => process.kill(relaunched, 0), { code: "ESRCH" });
});

test("debug traces distinguish static updates and config edits without unnecessary server replacement", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "index.js": "console.log(1)",
    "index.html": "hello",
  });
  const config = {
    bundler: {
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
    },
    server: { host: "127.0.0.1", port: 0, delay: 70, debug: true },
  };
  const filename = path.join(cwd, "tinybuild.config.mjs");
  await fs.writeFile(filename, "export default " + JSON.stringify(config));
  const events = [];
  app = await packager(config, {
    cwd,
    configPath: filename,
    log() {},
    onEvent: (event) => events.push(event),
  });
  const server = app.server;
  const builds = app.stats.builds;
  await fs.writeFile(path.join(cwd, "index.html"), "updated");
  await until(() => events.some((event) => event.action === "static"));
  assert.equal(app.stats.builds, builds);
  assert.match(await (await fetch(server.url)).text(), /updated/);
  config.bundler.minify = false;
  await fs.writeFile(filename, "export default " + JSON.stringify(config));
  await until(() => app.stats.builds > builds);
  assert.deepEqual(
    events.findLast((event) => event.action === "config").services,
    [],
  );
  assert.equal(app.server, server);
  config.server.headers = { "x-demo": "yes" };
  await fs.writeFile(filename, "export default " + JSON.stringify(config));
  await until(() => app.stats.builds > builds + 1);
  assert.deepEqual(
    events.findLast((event) => event.action === "config").services,
    ["server"],
  );
  assert.equal((await fetch(app.server.url)).headers.get("x-demo"), "yes");
});

test("native summaries list current files and complete app directories without following symlinks", async (t) => {
  const cwd = await fixture(t, {
    "index.html": "hello",
    "index.js": "console.log(1)",
    "dist/index.js": "1;",
    "release/demo-win32-x64/resources/sidecar.js": "backend",
    "release/demo.zip": "zip",
  });
  const config = {
    bundler: { outdir: "dist" },
    electron: { action: "package", outdir: "release" },
  };
  await fs.symlink(
    cwd,
    path.join(cwd, "release/loop"),
    process.platform === "win32" ? "junction" : "dir",
  );
  // A portable packaging plan; installed-runtime execution has a separate UI check.
  const result = await packageNative(config, [], { cwd, dryRun: true });
  assert.deepEqual(result.artifacts, [
    {
      directory: path.join(cwd, "release"),
      exists: true,
      entries: [
        { path: path.join(cwd, "release/demo-win32-x64"), type: "directory" },
        { path: path.join(cwd, "release/demo.zip"), type: "file" },
      ],
    },
  ]);
  const events = [],
    logs = [];
  const app = await runTinybuild(
    {
      build: true,
      bundler: {
        entryPoints: ["index.js"],
        outdir: "dist",
        autoInstall: false,
      },
      server: false,
      electron: config.electron,
    },
    {
      cwd,
      native: { dryRun: true },
      onEvent: (event) => events.push(event),
      log: (text) => logs.push(text),
    },
  );
  await app.close();
  assert.deepEqual(
    events.find((event) => event.type === "artifacts").artifacts,
    result.artifacts,
  );
  assert.ok(logs.some((text) => text.includes("complete app folders")));
  await fs.rm(path.join(cwd, "release"), { recursive: true });
  const missing = await packageNative(config, [], { cwd, dryRun: true });
  assert.deepEqual(missing.artifacts, [
    { directory: path.join(cwd, "release"), exists: false, entries: [] },
  ]);
});

test("debug traces explain saves queued during compilation and publish only the settled result", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "index.js": "console.log(1)",
    "next.js": "console.log(2)",
  });
  let block = false,
    release,
    started;
  const events = [];
  const reached = new Promise((resolve) => {
    started = resolve;
  });
  app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
        plugins: [
          {
            name: "pause-once",
            setup(build) {
              build.onStart(async () => {
                if (!block) return;
                block = false;
                started();
                await new Promise((resolve) => {
                  release = resolve;
                });
              });
            },
          },
        ],
      },
      server: { host: "127.0.0.1", port: 0, debug: true, delay: 0 },
    },
    { cwd, watch: false, log() {}, onEvent: (event) => events.push(event) },
  );
  block = true;
  const first = app.rebuild(["index.js"]);
  await reached;
  const queued = app.rebuild(["next.js"]);
  release();
  await Promise.all([first, queued]);
  await until(
    () =>
      app.stats.builds === 3 &&
      events.filter((event) => event.type === "built").length === 2,
  );
  assert.deepEqual(events.find((event) => event.action === "queued").files, [
    "next.js",
  ]);
  assert.match(
    events.findLast((event) => event.action === "rebuild").message,
    /queued/,
  );
});
