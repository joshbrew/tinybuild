import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import chokidar from "chokidar";
import { terminateChild } from "./process.js";

export function taskOrder(tasks = {}) {
  const result = [],
    active = new Set(),
    visited = new Set();
  function visit(name) {
    if (!Object.hasOwn(tasks, name))
      throw new Error("Unknown task dependency: " + name);
    if (active.has(name))
      throw new Error(
        "Task dependency cycle: " + [...active, name].join(" -> "),
      );
    if (visited.has(name)) return;
    const task = tasks[name];
    if (
      !task ||
      typeof task.command !== "string" ||
      !task.command ||
      (task.args &&
        (!Array.isArray(task.args) ||
          task.args.some((arg) => typeof arg !== "string")))
    )
      throw new Error("Task requires a command and string arguments: " + name);
    if (task.mode && !["once", "service"].includes(task.mode))
      throw new Error("Unknown task mode: " + name);
    for (const value of [task.timeout, task.ready?.timeout, task.delay])
      if (value !== undefined && (!Number.isFinite(value) || value < 0))
        throw new Error("Invalid task timeout/delay: " + name);
    if (
      task.dependsOn &&
      (!Array.isArray(task.dependsOn) ||
        task.dependsOn.some((value) => typeof value !== "string"))
    )
      throw new Error("Task dependencies must be a string array: " + name);
    if (
      task.watch &&
      (!Array.isArray(task.watch) ||
        task.watch.some((value) => typeof value !== "string"))
    )
      throw new Error("Task watch paths must be a string array: " + name);
    if (task.ready?.url && task.ready?.stdout)
      throw new Error("Choose URL or stdout readiness: " + name);
    if (task.ready?.url && !/^https?:\/\//.test(task.ready.url))
      throw new Error("Task readiness URL must use HTTP(S): " + name);
    if (
      task.ready?.stdout !== undefined &&
      (typeof task.ready.stdout !== "string" || !task.ready.stdout.length)
    )
      throw new Error(
        "Task readiness stdout must be a nonempty string: " + name,
      );
    active.add(name);
    for (const dependency of task.dependsOn || []) visit(dependency);
    active.delete(name);
    visited.add(name);
    result.push(name);
  }
  Object.keys(tasks).forEach(visit);
  return result;
}

export async function startTasks(
  tasks = {},
  {
    cwd = process.cwd(),
    onEvent = () => {},
    onError = () => {},
    silent = false,
    signal,
    killTimeout = 2000,
  } = {},
) {
  const order = taskOrder(tasks);
  const records = new Map(),
    watchers = [],
    debounceTimers = new Set();
  const abort = new AbortController();
  let closed = false,
    closing,
    queue = Promise.resolve();
  const status = {};
  const event = (name, state, extra = {}) => {
    status[name] = { state, ...extra };
    onEvent({ task: name, ...status[name] });
  };
  async function stop(name) {
    const record = records.get(name);
    if (!record) return;
    record.stopping = true;
    if (!record.exited) {
      await terminateChild(record.child);
      const timer = setTimeout(
        () => terminateChild(record.child, "SIGKILL").catch(onError),
        killTimeout,
      );
      timer.unref?.();
      try {
        await record.done;
      } finally {
        clearTimeout(timer);
      }
    }
    records.delete(name);
    event(name, "stopped");
  }
  async function launch(name) {
    if (closed) throw new Error("Task workspace is closed");
    const task = tasks[name];
    event(name, "starting");
    const child = spawn(
      task.command === "node" ? process.execPath : task.command,
      task.args || [],
      {
        cwd: path.resolve(cwd, task.cwd || "."),
        env: { ...process.env, ...task.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      },
    );
    let resolveExit, resolveOutput, rejectSpawn;
    const done = new Promise((resolve) => {
      resolveExit = resolve;
    });
    const outputReady = new Promise((resolve) => {
      resolveOutput = resolve;
    });
    const spawned = new Promise((resolve, reject) => {
      rejectSpawn = reject;
      child.once("spawn", resolve);
    });
    const record = { child, done, stopping: false, exited: false, output: "" };
    records.set(name, record);
    const consume = (chunk, stderr) => {
      if (!silent)
        (stderr || outputContext.getStore()?.machine
          ? process.stderr
          : process.stdout
        ).write(chunk);
      record.output = (record.output + chunk.toString()).slice(-65536);
      if (task.ready?.stdout && record.output.includes(task.ready.stdout))
        resolveOutput();
    };
    child.stdout.on("data", (chunk) => consume(chunk, false));
    child.stderr.on("data", (chunk) => consume(chunk, true));
    child.once("error", (error) => {
      rejectSpawn(error);
      record.error = error;
    });
    child.once("close", (code, signal) => {
      record.exited = true;
      record.code = code;
      record.signal = signal;
      resolveExit(record);
      if (
        !record.stopping &&
        !closed &&
        status[name]?.state === "ready" &&
        task.mode !== "once"
      ) {
        const error =
          record.error ||
          new Error(
            "Task " + name + " exited unexpectedly (" + (signal || code) + ")",
          );
        event(name, "failed", { code, signal });
        onError(error);
        queue = queue
          .then(async () => {
            for (const dependent of affected(name).slice(1).reverse())
              await stop(dependent);
          })
          .catch(onError);
      }
    });
    const exitFailure = done.then(() => {
      throw (
        record.error ||
        new Error(
          "Task " +
            name +
            " exited before readiness (" +
            (record.signal || record.code) +
            ")",
        )
      );
    });
    // A rejected branch remains observed when another branch wins the readiness race.
    exitFailure.catch(() => {});
    try {
      await spawned;
      if (task.mode === "once") {
        const cancel = () => stop(name).catch(onError);
        abort.signal.addEventListener("abort", cancel, { once: true });
        if (abort.signal.aborted) cancel();
        const timer = setTimeout(() => {
          record.timedOut = true;
          terminateChild(child, "SIGKILL").catch(onError);
        }, task.timeout ?? 60000);
        try {
          await done;
        } finally {
          clearTimeout(timer);
          abort.signal.removeEventListener("abort", cancel);
        }
        if (closed) throw new Error("Task workspace closed: " + name);
        if (record.timedOut) throw new Error("Task timed out: " + name);
        if (record.code !== 0)
          throw (
            record.error ||
            new Error(
              "Task " +
                name +
                " failed (" +
                (record.signal || record.code) +
                ")",
            )
          );
        event(name, "completed", { code: 0 });
        return;
      }
      const timeout = task.ready?.timeout ?? 10000;
      const readyAbort = new AbortController();
      const relay = () => readyAbort.abort();
      abort.signal.addEventListener("abort", relay, { once: true });
      if (abort.signal.aborted) relay();
      const timer = setTimeout(() => readyAbort.abort(), timeout);
      try {
        const readiness = task.ready?.url
          ? (async () => {
              while (!readyAbort.signal.aborted) {
                try {
                  const response = await fetch(task.ready.url, {
                    signal: readyAbort.signal,
                  });
                  await response.body?.cancel();
                  if (response.status === (task.ready.status || 200)) return;
                } catch (error) {
                  if (readyAbort.signal.aborted) throw error;
                }
                await pause(50, undefined, { signal: readyAbort.signal });
              }
              throw new Error("Readiness aborted");
            })()
          : task.ready?.stdout
            ? outputReady
            : Promise.resolve();
        const cancelled = new Promise((_, reject) => {
          if (readyAbort.signal.aborted)
            reject(new Error("Task readiness aborted: " + name));
          else
            readyAbort.signal.addEventListener(
              "abort",
              () =>
                reject(
                  new Error(
                    "Task readiness timed out or workspace closed: " + name,
                  ),
                ),
              { once: true },
            );
        });
        await Promise.race([readiness, exitFailure, cancelled]);
      } finally {
        clearTimeout(timer);
        readyAbort.abort();
        abort.signal.removeEventListener("abort", relay);
      }
      if (closed || record.exited)
        throw new Error("Task stopped during readiness: " + name);
      event(name, "ready", { pid: child.pid });
    } catch (error) {
      event(name, "failed", { message: error.message });
      throw error;
    }
  }
  function affected(name) {
    if (!Object.hasOwn(tasks, name)) throw new Error("Unknown task: " + name);
    const selected = new Set([name]);
    for (const candidate of order)
      if (
        (tasks[candidate].dependsOn || []).some((dependency) =>
          selected.has(dependency),
        )
      )
        selected.add(candidate);
    return order.filter((candidate) => selected.has(candidate));
  }
  const restartPending = new Set();
  let restarting;
  const controller = {
    status,
    restart(name) {
      for (const item of affected(name)) restartPending.add(item);
      if (restarting) return restarting;
      const operation = queue.then(async () => {
        while (!closed && restartPending.size) {
          const names = order.filter((item) => restartPending.has(item));
          restartPending.clear();
          for (const item of [...names].reverse()) await stop(item);
          // Changes that arrived while these processes stopped are included in
          // the fresh processes about to start, rather than another queued restart.
          for (const item of names) restartPending.delete(item);
          try {
            for (const item of names) await launch(item);
          } catch (error) {
            for (const item of [...names].reverse()) await stop(item);
            throw error;
          }
        }
      });
      restarting = operation.finally(() => {
        restarting = undefined;
      });
      queue = restarting.catch((error) => {
        onError(error);
      });
      return restarting;
    },
    close() {
      if (closing) return closing;
      closed = true;
      abort.abort();
      closing = (async () => {
        for (const watcher of watchers) await watcher.close();
        for (const timer of debounceTimers) clearTimeout(timer);
        debounceTimers.clear();
        await queue;
        for (const name of [...order].reverse()) await stop(name);
        signal?.removeEventListener("abort", handleAbort);
      })();
      return closing;
    },
  };
  const handleAbort = () => {
    controller.close().catch(onError);
  };
  signal?.addEventListener("abort", handleAbort, { once: true });
  if (signal?.aborted) handleAbort();
  try {
    for (const name of order) await launch(name);
    for (const name of order) {
      if (!tasks[name].watch?.length) continue;
      const watcher = chokidar.watch(
        tasks[name].watch.map((filename) =>
          path.resolve(cwd, tasks[name].cwd || ".", filename),
        ),
        {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
        },
      );
      watchers.push(watcher);
      let timer;
      watcher.on("all", (event) => {
        if (!["add", "change", "unlink"].includes(event)) return;
        clearTimeout(timer);
        debounceTimers.delete(timer);
        timer = setTimeout(() => {
          debounceTimers.delete(timer);
          controller.restart(name).catch(() => {});
        }, tasks[name].delay ?? 150);
        debounceTimers.add(timer);
      });
      watcher.on("close", () => clearTimeout(timer));
      await new Promise((resolve, reject) => {
        watcher.once("ready", resolve);
        watcher.once("error", reject);
      });
    }
    return controller;
  } catch (error) {
    await controller.close();
    throw error;
  }
}
import { outputContext } from "./reporting.js";
