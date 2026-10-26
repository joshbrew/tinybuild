// Electron supplies this separate Node runtime, including in packaged apps.
// stdout is for logs; request/reply messages use the private parent port.
const port = process.parentPort;
port.on("message", ({ data }) => {
  if (data.type === "shutdown") {
    process.exit(0);
    return;
  }
  if (
    !Number.isSafeInteger(data.value) ||
    data.value < 0 ||
    data.value > 1000000
  ) {
    port.postMessage({
      id: data.id,
      error: "Use an integer from 0 to 1000000",
    });
    return;
  }
  port.postMessage({
    id: data.id,
    result: data.value * data.value,
    pid: process.pid,
  });
});
port.postMessage({ type: "ready", pid: process.pid });
