import { createWorker } from "./leaf.worker";
const leaf = createWorker();
leaf.onmessage = ({ data }) => {
  postMessage(data);
  leaf.terminate();
};
onmessage = ({ data }) => leaf.postMessage(data);
