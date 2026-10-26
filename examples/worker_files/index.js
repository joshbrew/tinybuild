import workerURL from "./task.worker.js";
const output = document.createElement("pre");
document.body.append(output);
const worker = new Worker(workerURL, { type: "module" });
worker.onmessage = (event) => {
  output.textContent = String(event.data);
};
worker.postMessage(21);
addEventListener("beforeunload", () => worker.terminate(), { once: true });
