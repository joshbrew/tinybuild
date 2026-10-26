import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { once } from "node:events";
import { WebSocket } from "ws";
import { packager } from "../tinybuild/packager.js";
import {
  fixture,
  until,
  delay,
  request,
  renameForEditorSave,
} from "./helpers.js";

test("200 save batches recover from rename/delete/errors without accumulating reloads or resources", async (t) => {
  let app, socket;
  // Close owned processes before fixture cleanup, including on assertion failure.
  t.after(async () => {
    socket?.terminate();
    await app?.close();
  });
  const files = { "index.html": '<script src="dist/index.js"></script>' };
  files["index.js"] =
    Array.from(
      { length: 10 },
      (_, i) => `import {value as v${i}} from './part-${i}.js';`,
    ).join("\n") +
    "\nglobalThis.total=" +
    Array.from({ length: 10 }, (_, i) => `v${i}`).join("+") +
    ";";
  for (let i = 0; i < 10; i++)
    files[`part-${i}.js`] = `export const value=${i};`;
  const cwd = await fixture(t, files);
  let built = 0,
    errors = 0,
    taskStarts = 0,
    active = 0,
    maximumActive = 0;
  const config = {
    bundler: {
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
      logLevel: "silent",
      plugins: [
        {
          name: "soak-observer",
          setup(build) {
            build.onStart(() => {
              maximumActive = Math.max(maximumActive, ++active);
            });
            build.onEnd(() => {
              active--;
            });
          },
        },
      ],
    },
    server: { host: "127.0.0.1", port: 0 },
    tasks: {
      backend: {
        command: process.execPath,
        args: ["-e", 'console.log("READY");setInterval(()=>{},1000)'],
        ready: { stdout: "READY", timeout: 5000 },
      },
    },
  };
  const options = {
    cwd,
    onError() {},
    tasks: {
      silent: true,
      onEvent(event) {
        if (event.state === "starting") taskStarts++;
      },
    },
  };
  app = await packager(config, options);
  const server = app.server,
    watcher = app.watcher;
  const backendPid = app.tasks.status.backend.pid;
  const watchedCount = () =>
    Object.values(watcher.getWatched()).reduce(
      (n, entries) => n + entries.length,
      0,
    );
  const initialWatched = watchedCount();
  async function connect() {
    socket = new WebSocket(server.url.replace("http:", "ws:") + "/hotreload");
    socket.on("message", (data) => {
      const message = JSON.parse(data);
      if (message.type === "built") built++;
      if (message.type === "error") errors++;
    });
    await once(socket, "open");
    await until(() => server.SOCKETS.hotreload.wss.clients.size === 1);
  }
  await connect();
  let baselineHeap,
    followUpBuilds = 0;
  for (let batch = 1; batch <= 200; batch++) {
    const before = built,
      builds = app.stats.builds;
    const mode = batch % 5;
    if (mode === 2 || mode === 3) {
      const beforeError = errors;
      if (mode === 2) await fs.unlink(path.join(cwd, "part-0.js"));
      else await fs.writeFile(path.join(cwd, "part-0.js"), "export const = ;");
      await until(() => errors === beforeError + 1);
      assert.equal(
        built,
        before,
        "Broken source must not publish a successful reload",
      );
      assert.equal(
        (await request(server.SERVER, "/_tinybuild/ready")).status,
        503,
      );
    }
    await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const filename = path.join(cwd, `part-${i}.js`);
        const source = `export const value=${batch * 10 + i};`;
        if (mode === 1) {
          const temporary = filename + ".tmp";
          await fs.writeFile(temporary, source);
          await renameForEditorSave(temporary, filename);
        } else await fs.writeFile(filename, source);
      }),
    );
    await until(() => built > before);
    // Include another full watcher/quiet window so delayed duplicate events count.
    await delay(250);
    assert.equal(
      built,
      before + 1,
      `Batch ${batch} must send exactly one successful reload`,
    );
    // A save notification received during compilation needs one conservative
    // follow-up build. It must still publish only the single settled reload.
    const rebuilds = app.stats.builds - builds;
    assert.ok(
      rebuilds >= 1 && rebuilds <= 2,
      `Batch ${batch} used ${rebuilds} builds instead of one settled build and at most one follow-up`,
    );
    followUpBuilds += rebuilds - 1;
    assert.equal(app.server, server);
    assert.equal(app.watcher, watcher);
    const output = await request(server.SERVER, "/dist/index.js");
    const context = {};
    vm.runInNewContext(output.body, context);
    assert.equal(
      context.total,
      batch * 100 + 45,
      `Batch ${batch} must serve current code`,
    );
    assert.equal(
      (await request(server.SERVER, "/_tinybuild/ready")).status,
      200,
    );
    assert.equal(
      app.tasks.status.backend.pid,
      backendPid,
      "Web edits must preserve the backend",
    );
    assert.ok(
      watchedCount() <= initialWatched + 2,
      "Temporary saves must not accumulate watched files",
    );
    if (batch % 25 === 0) {
      const closed = once(socket, "close");
      socket.close();
      await closed;
      await until(() => server.SOCKETS.hotreload.wss.clients.size === 0);
      await connect();
      globalThis.gc?.();
      const heap = process.memoryUsage().heapUsed;
      baselineHeap ??= heap;
      assert.ok(
        heap - baselineHeap < 32 * 1024 * 1024,
        "Retained JavaScript heap grew by more than 32 MiB",
      );
      t.diagnostic(
        `${batch}/200 batches; heap ${Math.round(heap / 1024 / 1024)} MiB; ${watchedCount()} watched entries`,
      );
    }
  }
  assert.equal(maximumActive, 1);
  assert.equal(active, 0);
  assert.equal(taskStarts, 1);
  assert.equal(errors, 80);
  t.diagnostic(
    `${followUpBuilds} follow-up builds for notifications received during compilation; 200 successful reloads`,
  );
  socket.terminate();
  await app.close();
  assert.equal(server.SERVER.listening, false);
  assert.equal(server.SOCKETS.hotreload.wss.clients.size, 0);
  assert.equal(watchedCount(), 0);
  assert.throws(() => process.kill(backendPid, 0), { code: "ESRCH" });
  // Reopening the same project must also dispose every watcher, listener and task.
  for (let session = 0; session < 3; session++) {
    app = await packager(config, options);
    const pid = app.tasks.status.backend.pid;
    await app.close();
    assert.equal(app.server.SERVER.listening, false);
    assert.deepEqual(app.watcher.getWatched(), {});
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }
});
