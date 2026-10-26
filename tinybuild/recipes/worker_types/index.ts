import workerURL, { createWorker } from "./math.Worker";

const output = document.querySelector("output")!;
const worker: Worker = createWorker({ name: "typed-calculation" });
output.dataset.workerUrl = workerURL;
worker.onmessage = ({ data }: MessageEvent<number>) => {
  output.textContent = "Worker result: " + data;
  worker.terminate();
};
worker.onerror = ({ message }) => {
  output.textContent = message;
  worker.terminate();
};
worker.postMessage(21);
addEventListener("beforeunload", () => worker.terminate(), { once: true });
