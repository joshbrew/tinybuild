import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { startTasks, taskOrder } from "../tinybuild/tasks.js";
import { packager } from "../tinybuild/packager.js";
import { fixture, until } from "./helpers.js";

const service = {
  command: "node",
  args: ["-e", 'console.log("READY");setInterval(()=>{},1000)'],
  ready: { stdout: "READY", timeout: 3000 },
};
test("task graphs reject unknown dependencies, cycles and malformed commands before spawning", () => {
  assert.throws(
    () => taskOrder({ a: { ...service, dependsOn: ["missing"] } }),
    /Unknown task dependency/,
  );
  assert.throws(
    () =>
      taskOrder({
        a: { ...service, dependsOn: ["b"] },
        b: { ...service, dependsOn: ["a"] },
      }),
    /cycle/,
  );
  assert.throws(
    () => taskOrder({ bad: { command: "node", args: "file.js" } }),
    /string arguments/,
  );
  assert.throws(
    () => taskOrder({ bad: { ...service, ready: { url: "file:///private" } } }),
    /HTTP/,
  );
});

test("tasks wait for dependencies, cascade restarts and stop dependents before their services", async (t) => {
  let workspace;
  t.after(() => workspace?.close());
  const root = await fixture(t);
  const events = [];
  workspace = await startTasks(
    {
      prepare: {
        command: "node",
        args: ["-e", 'require("fs").writeFileSync("prepared.txt","ready")'],
        mode: "once",
      },
      backend: { ...service, dependsOn: ["prepare"] },
      frontend: { ...service, dependsOn: ["backend"] },
    },
    { cwd: root, silent: true, onEvent: (event) => events.push(event) },
  );
  assert.equal(
    await fs.readFile(path.join(root, "prepared.txt"), "utf8"),
    "ready",
  );
  assert.ok(
    events.findIndex(
      (event) => event.task === "backend" && event.state === "ready",
    ) <
      events.findIndex(
        (event) => event.task === "frontend" && event.state === "starting",
      ),
  );
  const backendPID = workspace.status.backend.pid;
  await workspace.restart("backend");
  assert.notEqual(workspace.status.backend.pid, backendPID);
  assert.equal(
    events.filter(
      (event) => event.task === "frontend" && event.state === "ready",
    ).length,
    2,
  );
  await Promise.all([workspace.close(), workspace.close()]);
  assert.deepEqual(
    events
      .filter((event) => event.state === "stopped")
      .slice(-3)
      .map((event) => event.task),
    ["frontend", "backend", "prepare"],
  );
});

test("HTTP readiness waits for the actual service and watched edits restart its dependents", async (t) => {
  let workspace;
  t.after(() => workspace?.close());
  const root = await fixture(t, { "trigger.txt": "one" });
  const probe = http.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const events = [];
  workspace = await startTasks(
    {
      api: {
        command: "node",
        args: [
          "-e",
          'require("http").createServer((q,s)=>s.end("ok")).listen(' +
            port +
            ',"127.0.0.1")',
        ],
        ready: { url: "http://127.0.0.1:" + port, timeout: 3000 },
        watch: ["trigger.txt"],
        delay: 5,
      },
      client: { ...service, dependsOn: ["api"] },
    },
    { cwd: root, silent: true, onEvent: (event) => events.push(event) },
  );
  await fs.writeFile(path.join(root, "trigger.txt"), "two");
  await until(
    () =>
      events.filter(
        (event) => event.task === "client" && event.state === "ready",
      ).length === 2,
  );
  assert.equal(await (await fetch("http://127.0.0.1:" + port)).text(), "ok");
});

test("task startup failures and readiness timeouts roll back already-started services", async (t) => {
  const root = await fixture(t);
  const events = [];
  await assert.rejects(
    startTasks(
      {
        first: service,
        broken: {
          command: "node",
          args: ["-e", "process.exit(3)"],
          mode: "once",
          dependsOn: ["first"],
        },
      },
      { cwd: root, silent: true, onEvent: (event) => events.push(event) },
    ),
    /failed \(3\)/,
  );
  assert.ok(
    events.some((event) => event.task === "first" && event.state === "stopped"),
  );
  await assert.rejects(
    startTasks(
      { hung: { ...service, ready: { stdout: "NEVER", timeout: 100 } } },
      { cwd: root, silent: true },
    ),
    /timed out/,
  );
  await assert.rejects(
    startTasks(
      { missing: { command: "tinybuild-does-not-exist-123" } },
      { cwd: root, silent: true },
    ),
    /ENOENT/,
  );
  await assert.rejects(
    startTasks(
      {
        hung: {
          command: "node",
          args: ["-e", "setInterval(()=>{},1000)"],
          mode: "once",
          timeout: 100,
        },
      },
      { cwd: root, silent: true },
    ),
    /timed out/,
  );
});

test("unexpected service exits are reported and abort signals shut down owned children", async (t) => {
  let workspace;
  t.after(() => workspace?.close());
  const root = await fixture(t);
  const errors = [],
    abort = new AbortController();
  workspace = await startTasks(
    {
      transient: {
        command: "node",
        args: [
          "-e",
          'console.log("READY");setTimeout(()=>process.exit(4),1000)',
        ],
        ready: { stdout: "READY" },
      },
      client: { ...service, dependsOn: ["transient"] },
    },
    {
      cwd: root,
      silent: true,
      signal: abort.signal,
      onError: (error) => errors.push(error),
    },
  );
  await until(() => errors.length === 1);
  await until(() => workspace.status.client.state === "stopped");
  assert.match(errors[0].message, /unexpectedly/);
  abort.abort();
  await workspace.close();
  assert.equal(workspace.status.transient.state, "stopped");
});

test("failed restarts roll back dependent services and a later edit can recover the workspace", async (t) => {
  let workspace;
  t.after(() => workspace?.close());
  const root = await fixture(t, {
    "backend.mjs": 'console.log("READY");setInterval(()=>{},1000);',
  });
  workspace = await startTasks(
    {
      api: { ...service, args: ["backend.mjs"] },
      client: { ...service, dependsOn: ["api"] },
    },
    { cwd: root, silent: true },
  );
  await fs.writeFile(path.join(root, "backend.mjs"), "process.exit(2);");
  await assert.rejects(workspace.restart("api"), /exited before readiness/);
  assert.equal(workspace.status.client.state, "stopped");
  await fs.writeFile(
    path.join(root, "backend.mjs"),
    'console.log("READY");setInterval(()=>{},1000);',
  );
  await workspace.restart("api");
  assert.equal(workspace.status.client.state, "ready");
});

test("packager owns development tasks and skips services during one-shot builds", async (t) => {
  let app;
  t.after(() => app?.close());
  const root = await fixture(t);
  app = await packager(
    { bundler: false, server: false, tasks: { backend: service } },
    { cwd: root, tasks: { silent: true } },
  );
  assert.equal(app.tasks.status.backend.state, "ready");
  await app.close();
  assert.equal(app.tasks.status.backend.state, "stopped");
  app = await packager(
    { build: true, bundler: false, server: false, tasks: { backend: service } },
    { cwd: root },
  );
  assert.equal(app.tasks, undefined);
});
