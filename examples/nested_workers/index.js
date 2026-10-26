import { createWorker } from "./outer.Worker";
const worker = createWorker();
worker.onmessage = ({ data }) => {
  document.querySelector("output").textContent = data;
  worker.terminate();
};
worker.onerror = ({ message }) => {
  document.querySelector("output").textContent = message;
  worker.terminate();
};
worker.postMessage(21);
