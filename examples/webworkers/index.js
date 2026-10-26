import workerURL from "./worker.js";
const output = document.createElement("pre");
document.body.append(output);
const worker = new Worker(workerURL);
worker.onmessage = (event) => {
  output.textContent = "Worker replied: " + event.data;
};
worker.postMessage("hello from the page");
addEventListener(
  "beforeunload",
  () => {
    worker.terminate();
    URL.revokeObjectURL(workerURL);
  },
  { once: true },
);
