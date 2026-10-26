import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";

const source = await fs.readFile(
  new URL("../examples/electron_sidecar/native/app.cjs", import.meta.url),
  "utf8",
);

// Run the real shell with controlled IPC and a clock. No SDK or five-second waits.
async function shell() {
  const app = new EventEmitter(),
    child = new EventEmitter();
  const timers = new Map(),
    handlers = new Map(),
    errors = [],
    sent = [];
  let clock = 0,
    nextTimer = 0,
    quits = 0,
    kills = 0,
    sender;
  app.whenReady = () => Promise.resolve();
  app.quit = () => {
    let prevented = false;
    app.emit("before-quit", {
      preventDefault() {
        prevented = true;
      },
    });
    if (!prevented) quits++;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    kills++;
    child.emit("exit", 1);
    return true;
  };
  child.postMessage = (message) => sent.push(message);
  class BrowserWindow {
    constructor() {
      this.webContents = sender = { setWindowOpenHandler() {} };
    }
    async loadFile() {}
  }
  const context = vm.createContext({
    __dirname: "/shell",
    process: { env: {}, stdout: { write() {} }, stderr: { write() {} } },
    setTimeout(fn, ms) {
      const id = ++nextTimer;
      timers.set(id, { fn, at: clock + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    require(name) {
      if (name === "node:path") return path;
      assert.equal(name, "electron");
      return {
        app,
        BrowserWindow,
        ipcMain: {
          handle(name, fn) {
            handlers.set(name, fn);
          },
        },
        utilityProcess: {
          fork() {
            return child;
          },
        },
        dialog: {
          showErrorBox(title, message) {
            errors.push({ title, message });
          },
        },
      };
    },
  });
  vm.runInContext(source, context);
  async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }
  await flush();
  return {
    app,
    child,
    errors,
    sent,
    timers,
    get quits() {
      return quits;
    },
    get kills() {
      return kills;
    },
    async ready() {
      child.emit("message", { type: "ready", pid: 321 });
      await flush();
    },
    calculate(value) {
      return handlers.get("sidecar:calculate")({ sender }, value);
    },
    advance(ms) {
      clock += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= clock && timers.delete(id)) timer.fn();
      }
      return flush();
    },
    flush,
  };
}

test("sidecar startup failures and hung readiness close the app and release their timers", async () => {
  for (const mode of ["timeout", "exit", "error"]) {
    const state = await shell();
    if (mode === "timeout") await state.advance(5000);
    else if (mode === "exit") state.child.emit("exit", 2);
    else state.child.emit("error", Error("could not launch"));
    await state.flush();
    assert.equal(state.errors.length, 1);
    assert.match(state.errors[0].message, /timed out|stopped|could not launch/);
    assert.equal(state.quits, 1);
    assert.equal(state.timers.size, 0);
  }
});

test("sidecar crashes reject every pending request and refuse subsequent work", async () => {
  const state = await shell();
  await state.ready();
  const jobs = [state.calculate(7), state.calculate(12)].map((job) =>
    assert.rejects(job, /stopped/),
  );
  state.child.emit("exit", 9);
  await Promise.all(jobs);
  await assert.rejects(state.calculate(3), /stopped/);
  assert.equal(state.timers.size, 0);
  assert.equal(
    state.errors.length,
    0,
    "A running window reports request errors through IPC",
  );
  state.app.quit();
  assert.equal(state.quits, 1);
});

test("a hung sidecar times out once, stops and ignores late replies", async () => {
  const state = await shell();
  await state.ready();
  const jobs = [state.calculate(7), state.calculate(12)].map((job) =>
    assert.rejects(job, /request timed out/),
  );
  await state.advance(3000);
  await Promise.all(jobs);
  state.child.emit("message", { id: 1, result: 49, pid: 321 });
  await assert.rejects(state.calculate(3), /request timed out/);
  assert.equal(state.kills, 1);
  assert.equal(state.timers.size, 0);
});

test("failed IPC sends reject immediately and release pending requests", async () => {
  const state = await shell();
  await state.ready();
  const previous = assert.rejects(state.calculate(7), /port closed/);
  state.child.postMessage = () => {
    throw Error("port closed");
  };
  await assert.rejects(state.calculate(12), /port closed/);
  await previous;
  assert.equal(state.kills, 1);
  assert.equal(state.timers.size, 0);
});

test("sidecar shutdown handles a hung backend and a broken shutdown channel", async () => {
  for (const broken of [false, true]) {
    const state = await shell();
    await state.ready();
    const job = assert.rejects(state.calculate(7), /closing/);
    if (broken)
      state.child.postMessage = () => {
        throw Error("port closed");
      };
    state.app.quit();
    await job;
    if (!broken) {
      assert.equal(state.quits, 0);
      assert.equal(state.sent.at(-1).type, "shutdown");
      state.app.quit();
      await state.advance(1500);
    }
    assert.equal(state.kills, 1);
    assert.equal(state.quits, 1);
    assert.equal(state.timers.size, 0);
  }
});

test("sidecar replies remain paired during concurrency and repeated app sessions", async () => {
  for (let session = 0; session < 25; session++) {
    const state = await shell();
    await state.ready();
    const first = state.calculate(7),
      second = state.calculate(12);
    state.child.emit("message", null);
    state.child.emit("message", { id: 2, result: 144, pid: 321 });
    state.child.emit("message", { id: 1, result: 49, pid: 321 });
    assert.equal((await first).result, 49);
    assert.equal((await second).result, 144);
    state.app.quit();
    state.child.emit("exit", 0);
    assert.equal(state.quits, 1);
    assert.equal(state.timers.size, 0);
  }
});
