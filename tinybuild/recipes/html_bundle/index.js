import "./style.css";
import workerURL from "./task.worker";
import icon from "./icon.svg";
document.body.innerHTML =
  '<h1>Portable HTML with an embedded worker</h1><img alt="embedded icon"><pre>Working...</pre>';
document.querySelector("img").src = icon;
const worker = new Worker(workerURL);
worker.onmessage = (event) => {
  document.querySelector("pre").textContent = "Worker result: " + event.data;
  worker.terminate();
  URL.revokeObjectURL(workerURL);
};
worker.postMessage(21);
