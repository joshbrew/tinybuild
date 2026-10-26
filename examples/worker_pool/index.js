import url from "./jobs.worker.js";
import { createWorkerPool } from "tinybuild/client/workers";
const pool = createWorkerPool(() => new Worker(url), { size: 2, maxQueue: 8 });
const output = document.querySelector("output");
const values = new Uint8Array([10, 20, 30]);
pool
  .run("double", values.buffer, { transfer: [values.buffer] })
  .then(
    (buffer) =>
      (output.textContent =
        "Transferred result: " + [...new Uint8Array(buffer)].join(", ")),
  );
const button = document.createElement("button");
button.textContent = "Cancel a slow job";
document.querySelector("main").append(button);
button.onclick = async () => {
  const abort = new AbortController();
  const task = pool.run("slow", null, { signal: abort.signal });
  abort.abort();
  try {
    await task;
  } catch (error) {
    output.textContent = "Cancelled: " + error.name;
  }
};
addEventListener("beforeunload", () => pool.close(), { once: true });
