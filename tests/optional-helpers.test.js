import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { WebSocketServer, WebSocket } from "ws";
import { fixture, until, request } from "./helpers.js";
import {
  serve,
  packager,
  analyzeBuild,
  saveBaseline,
  nativeApp,
} from "../tinybuild/packager.js";
import { createWorkerPool } from "../tinybuild/client/workers.js";
import { createNativeBridge } from "../tinybuild/client/native.js";

test("WebSocket proxy preserves paths, subprotocols and binary messages and closes upgraded connections", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, { "index.html": "test" });
  const backend = http.createServer();
  const wss = new WebSocketServer({ server: backend });
  const paths = [];
  wss.on("connection", (ws, req) => {
    paths.push(req.url);
    ws.on("message", (value, binary) => ws.send(value, { binary }));
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    await new Promise((r) => wss.close(r));
    await new Promise((r) => backend.close(r));
  });
  app = await serve({
    cwd,
    host: "127.0.0.1",
    port: 0,
    hotreload: false,
    proxy: {
      "/socket": {
        target: "http://127.0.0.1:" + backend.address().port + "/echo",
        stripPrefix: true,
        ws: true,
      },
    },
  });
  const ws = new WebSocket(
    app.url.replace("http:", "ws:") + "/socket/channel?q=1",
    "example",
  );
  await once(ws, "open");
  assert.equal(ws.protocol, "example");
  const next = once(ws, "message");
  ws.send(Buffer.from([0, 255, 42]));
  const [data, binary] = await next;
  assert.deepEqual(data, Buffer.from([0, 255, 42]));
  assert.equal(binary, true);
  assert.deepEqual(paths, ["/echo/channel?q=1"]);
  const ended = once(ws, "close");
  await app.close();
  await ended;
});

test("SSE reload replays errors, broadcasts recovery and drains clients on shutdown", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, { "index.html": "<h1>SSE</h1>" });
  app = await serve({
    cwd,
    host: "127.0.0.1",
    port: 0,
    hotreload: true,
    hotreloadTransport: "sse",
  });
  assert.match((await request(app.SERVER)).body, /,"sse"/);
  app.SOCKETS.hotreload.broadcast({ type: "error", message: "syntax error" });
  const req = http.get(app.url + "/hotreload/events");
  const [response] = await once(req, "response");
  let text = "";
  response.on("data", (data) => (text += data));
  await until(() => text.includes("syntax error"));
  app.SOCKETS.hotreload.broadcast({ type: "built", files: ["/dist/index.js"] });
  await until(() => text.includes('"built"'));
  const ended = once(response, "end");
  await app.close();
  await ended;
});

test("worker pools transfer buffers, propagate errors, bound queues, cancel tasks and replace crashed workers", async (t) => {
  const workerURL = new URL("../tinybuild/client/workers.js", import.meta.url)
    .href;
  const cwd = await fixture(t, {
    "worker.mjs": `import {parentPort} from 'node:worker_threads';import {serveWorker,transferResult} from ${JSON.stringify(workerURL)};serveWorker({double(buffer){const values=new Uint8Array(buffer);for(let i=0;i<values.length;i++)values[i]*=2;return transferResult(buffer,[buffer]);},fail(){throw new Error('handler failed');},wait(){return new Promise(r=>setTimeout(()=>r(42),1000));},crash(){process.exit(2);}},parentPort);`,
  });
  let created = 0;
  const pool = createWorkerPool(
    () => {
      created++;
      return new Worker(path.join(cwd, "worker.mjs"));
    },
    { size: 1, maxQueue: 1 },
  );
  t.after(() => pool.close());
  const data = new Uint8Array([1, 2, 3]);
  const task = pool.run("double", data.buffer, { transfer: [data.buffer] });
  assert.equal(data.byteLength, 0);
  assert.deepEqual([...new Uint8Array(await task)], [2, 4, 6]);
  await assert.rejects(pool.run("fail"), /handler failed/);
  const abort = new AbortController();
  const waiting = pool.run("wait", null, { signal: abort.signal });
  const queued = pool.run("wait");
  await assert.rejects(pool.run("wait"), /queue is full/);
  abort.abort();
  await assert.rejects(waiting, { name: "AbortError" });

  const closedTask = assert.rejects(queued, /closed/);
  await pool.close();
  await closedTask;
  await assert.rejects(pool.run("wait"), /closed/);
  const recovery = createWorkerPool(
    () => new Worker(path.join(cwd, "worker.mjs")),
    { size: 1 },
  );
  t.after(() => recovery.close());
  await assert.rejects(recovery.run("crash"), /exited/);
  await assert.rejects(recovery.run("wait", null, { timeout: 20 }), {
    name: "TimeoutError",
  });
  const buffer = new Uint8Array([4]).buffer;
  assert.equal(
    new Uint8Array(
      await recovery.run("double", buffer, { transfer: [buffer] }),
    )[0],
    8,
  );
  assert.ok(created >= 2);
});

test("compressed budgets, baseline growth and dependency reports share actual build outputs", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "index.js": "console.log(" + JSON.stringify("repeat".repeat(1000)) + ")",
  });
  app = await packager(
    {
      build: true,
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
      },
      diagnostics: { compression: true, report: "dist/report.html" },
    },
    { cwd },
  );
  assert.ok(app.report.gzipBytes < app.report.outputBytes);
  assert.ok(app.report.brotliBytes < app.report.gzipBytes);
  await saveBaseline(app.report, "baseline.json", { cwd });
  const report = await analyzeBuild(app.bundles, {
    cwd,
    baseline: "baseline.json",
    budgets: { gzipBytes: 1, brotliBytes: 1, growthBytes: 0 },
  });
  assert.equal(report.growthBytes, 0);
  assert.equal(report.violations.length, 2);
  assert.match(
    await fs.readFile(path.join(cwd, "dist/report.html"), "utf8"),
    /Search outputs or input dependencies/,
  );
  await assert.rejects(
    analyzeBuild(app.bundles, { cwd, budgets: { growthBytes: 0 } }),
    /requires diagnostics.baseline/,
  );
});

test("native presets deduplicate dependencies and permissions, respect explicit text and require secure storage providers", async () => {
  const config = nativeApp({
    presets: ["camera", "files", "notifications", "camera"],
    permissions: { ios: { NSCameraUsageDescription: "Scan a receipt." } },
  });
  assert.equal(config.native.plugins.length, 3);
  assert.equal(
    config.native.permissions.ios.NSCameraUsageDescription,
    "Scan a receipt.",
  );
  assert.ok(
    config.native.permissions.android.includes(
      "android.permission.POST_NOTIFICATIONS",
    ),
  );
  assert.throws(
    () => nativeApp({ presets: ["secureStorage"] }),
    /explicit plugin provider/,
  );
  assert.throws(
    () => nativeApp({ presets: ["typo"] }),
    /Unknown native preset/,
  );
  const bridge = createNativeBridge({
    native: { read: () => 42 },
    web: { read: () => 7 },
    isNative: () => false,
  });
  assert.equal(await bridge.call("read"), 7);
  await assert.rejects(bridge.call("secureStorage"), /unavailable/);
});

test("SDK smoke checks plan Android/iOS installs and verify process launch with an injected runner", async (t) => {
  const { smokeMobile } = await import("../tinybuild/mobile-smoke.js");
  const cwd = await fixture(t, { "demo.apk": "apk" });
  const artifact = path.join(cwd, "demo.apk");
  const calls = [];
  const result = await smokeMobile({
    platform: "android",
    id: "com.example.demo",
    device: "emulator-5554",
    artifact,
    run: async (command, args) => {
      calls.push([command, args]);
      return { stdout: args.includes("pidof") ? "1234" : "" };
    },
  });
  assert.equal(result.pid, "1234");
  assert.equal(calls.length, 3);
  const ios = await smokeMobile({
    platform: "ios",
    id: "com.example.demo",
    device: "booted",
    artifact: "demo.app",
    dryRun: true,
    hostPlatform: "win32",
  });
  assert.ok(ios.commands[2][1].includes("launch"));
  await assert.rejects(
    smokeMobile({
      platform: "android",
      id: "com.example.demo",
      device: "emulator-5554",
      artifact,
      run: async () => ({ stdout: "" }),
    }),
    /running process/,
  );
  await assert.rejects(
    smokeMobile({
      platform: "ios",
      id: "com.example.demo",
      device: "booted",
      artifact: "demo.app",
      hostPlatform: "win32",
    }),
    /macOS/,
  );
});

test("baseline command creates a missing baseline, skips native launch and preserves the baseline during cleanup", async (t) => {
  const { runTinybuild } = await import("../tinybuild/cli.js");
  const { cleanGenerated } = await import("../tinybuild/outputs.js");
  const cwd = await fixture(t, {
    "tinybuild.config.mjs":
      'export default {bundler:{entryPoints:["index.js"],outfile:"dist/index",autoInstall:false},diagnostics:{baseline:"baseline.json"},budgets:{growthBytes:0},mobile:{android:"build"},server:false};',
    "index.js": "console.log(42);",
  });
  const app = await runTinybuild(["baseline"], {
    cwd,
    native: {
      run: () => {
        throw new Error("SDK must not launch");
      },
    },
  });
  await app.close();
  const baseline = JSON.parse(
    await fs.readFile(path.join(cwd, "baseline.json"), "utf8"),
  );
  assert.ok(baseline.outputBytes > 0);
  await cleanGenerated({ cwd });
  await fs.access(path.join(cwd, "baseline.json"));
});
