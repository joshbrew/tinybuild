const transferable = Symbol("tinybuild.transfer");
export const transferResult = (value, transfer) => ({
  [transferable]: true,
  value,
  transfer,
});
const abortError = () =>
  Object.assign(new Error("Worker task aborted"), { name: "AbortError" });
function listen(port, type, handler) {
  if (typeof port.addEventListener === "function") {
    const callback =
      type === "message" ? (event) => handler(event.data) : handler;
    port.addEventListener(type, callback);
    port.start?.();
    return () => port.removeEventListener(type, callback);
  }
  port.on(type, handler);
  return () => port.off(type, handler);
}
// The optional explicit port makes the same handler usable with node:worker_threads.
export function serveWorker(handlers, port = globalThis) {
  const active = new Map();
  const remove = listen(port, "message", async (message) => {
    if (message?.tinybuild !== "rpc") return;
    if (message.cancel) {
      active.get(message.id)?.abort();
      return;
    }
    const controller = new AbortController();
    active.set(message.id, controller);
    try {
      if (
        typeof handlers[message.method] !== "function" ||
        !Object.hasOwn(handlers, message.method)
      )
        throw new Error("Unknown worker method: " + message.method);
      const result = await handlers[message.method](message.value, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted)
        port.postMessage(
          {
            tinybuild: "rpc",
            id: message.id,
            value: result?.[transferable] ? result.value : result,
          },
          result?.[transferable] ? result.transfer : [],
        );
    } catch (error) {
      if (!controller.signal.aborted)
        port.postMessage({
          tinybuild: "rpc",
          id: message.id,
          error: {
            name: error?.name || "Error",
            message: error?.message || String(error),
          },
        });
    } finally {
      active.delete(message.id);
    }
  });
  return () => {
    remove();
    for (const controller of active.values()) controller.abort();
    active.clear();
  };
}
export function createWorkerPool(
  factory,
  {
    size = Math.min(globalThis.navigator?.hardwareConcurrency || 2, 4),
    maxQueue = 100,
  } = {},
) {
  if (!Number.isInteger(size) || size < 1 || size > 256)
    throw new Error("Worker pool size must be 1–256");
  if (!Number.isInteger(maxQueue) || maxQueue < 0)
    throw new Error("maxQueue must be a nonnegative integer");
  const slots = Array.from({ length: size }, () => ({
    worker: null,
    task: null,
    remove: [],
  }));
  const queue = [];
  let closed = false,
    nextId = 0;
  function stop(slot) {
    for (const remove of slot.remove) remove();
    slot.remove = [];
    const worker = slot.worker;
    slot.worker = null;
    return Promise.resolve(worker?.terminate()).catch(() => {});
  }
  function finish(slot, error, value, replace = false) {
    const task = slot.task;
    if (!task) return;
    slot.task = null;
    task.cleanup();
    if (replace) void stop(slot);
    if (error) task.reject(error);
    else task.resolve(value);
    dispatch();
  }
  function start(slot) {
    slot.worker = factory();
    const failed = (error) => {
      if (slot.task) finish(slot, error, undefined, true);
      else {
        void stop(slot);
        dispatch();
      }
    };
    slot.remove.push(
      listen(slot.worker, "message", (message) => {
        if (message?.tinybuild !== "rpc" || message.id !== slot.task?.id)
          return;
        finish(
          slot,
          message.error
            ? Object.assign(new Error(message.error.message), {
                name: message.error.name,
              })
            : null,
          message.value,
        );
      }),
    );
    slot.remove.push(
      listen(slot.worker, "error", (error) =>
        failed(new Error(error.message || "Worker crashed")),
      ),
    );
    slot.remove.push(
      listen(slot.worker, "messageerror", () =>
        failed(new Error("Worker message could not be decoded")),
      ),
    );
    if (typeof slot.worker.on === "function")
      slot.remove.push(
        listen(slot.worker, "exit", (code) => {
          if (slot.worker) failed(new Error("Worker exited (" + code + ")"));
        }),
      );
  }
  function dispatch() {
    if (closed) return;
    for (const slot of slots) {
      if (slot.task || !queue.length) continue;
      const task = queue.shift();
      slot.task = task;
      try {
        if (!slot.worker) start(slot);
        slot.worker.postMessage(
          {
            tinybuild: "rpc",
            id: task.id,
            method: task.method,
            value: task.value,
          },
          task.transfer || [],
        );
      } catch (error) {
        finish(slot, error, undefined, true);
      }
    }
  }
  return {
    get stats() {
      return {
        size,
        active: slots.filter((slot) => slot.task).length,
        queued: queue.length,
        closed,
      };
    },
    run(method, value, { transfer, signal, timeout } = {}) {
      if (closed) return Promise.reject(new Error("Worker pool is closed"));
      if (signal?.aborted) return Promise.reject(abortError());
      if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0))
        return Promise.reject(new Error("Worker timeout must be nonnegative"));
      if (queue.length >= maxQueue && slots.every((slot) => slot.task))
        return Promise.reject(new Error("Worker queue is full"));
      return new Promise((resolve, reject) => {
        let timer;
        const task = {
          id: ++nextId,
          method,
          value,
          transfer,
          resolve,
          reject,
          cleanup: () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", cancel);
          },
        };
        function cancel(error = abortError()) {
          if (!(error instanceof Error)) error = abortError();
          const index = queue.indexOf(task);
          if (index >= 0) {
            queue.splice(index, 1);
            task.cleanup();
            reject(error);
            return;
          }
          const slot = slots.find((slot) => slot.task === task);
          if (slot) finish(slot, error, undefined, true); // Termination also cancels synchronous CPU work.
        }
        signal?.addEventListener("abort", cancel, { once: true });
        if (timeout !== undefined)
          timer = setTimeout(
            () =>
              cancel(
                Object.assign(new Error("Worker task timed out"), {
                  name: "TimeoutError",
                }),
              ),
            timeout,
          );
        queue.push(task);
        dispatch();
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      const error = new Error("Worker pool closed");
      for (const task of queue.splice(0)) {
        task.cleanup();
        task.reject(error);
      }
      for (const slot of slots)
        if (slot.task) {
          slot.task.cleanup();
          slot.task.reject(error);
          slot.task = null;
        }
      await Promise.all(slots.map(stop));
    },
  };
}
