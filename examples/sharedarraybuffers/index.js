import "./index.css";
import sharedURL from "./worker.js";
import transferURL from "./nonshared.worker.js";
const output = document.createElement("pre");
document.body.append(output);
const count = 256 * 256;
if (!crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
  output.textContent =
    "SharedArrayBuffer needs cross-origin isolation. Start this example with its configured server.";
} else {
  const sharedBuffer = new SharedArrayBuffer(count * 4);
  const shared = new Worker(sharedURL);
  shared.onmessage = () => {
    output.textContent = "Shared worker filled " + count + " pixels.\n";
    shared.terminate();
    const transfer = new Worker(transferURL);
    const buffer = new Uint8ClampedArray(count * 4);
    transfer.onmessage = (event) => {
      output.textContent +=
        "Transfer worker returned " + event.data.byteLength + " bytes.";
      transfer.terminate();
    };
    transfer.postMessage({ buffer: buffer.buffer, start: 0, end: count }, [
      buffer.buffer,
    ]);
  };
  shared.postMessage({ sharedBuffer, start: 0, end: count });
}
