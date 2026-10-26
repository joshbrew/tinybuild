import { Worker } from "node:worker_threads";
import workerPath from "./task.worker.js";
const worker = new Worker(workerPath);
worker.once("message", (value) => {
  console.log("Worker answer:", value);
  worker.terminate();
});
