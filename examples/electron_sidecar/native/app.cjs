const {
  app,
  BrowserWindow,
  ipcMain,
  utilityProcess,
  dialog,
} = require("electron");
const path = require("node:path");
let child,
  window,
  next = 0,
  stopping = false,
  exited = false,
  backendError;
const pending = new Map();
function fail(error) {
  for (const job of pending.values()) {
    clearTimeout(job.timer);
    job.reject(error);
  }
  pending.clear();
}
function stopBackend(error) {
  backendError ||= error;
  fail(backendError);
  if (!exited) child.kill();
}
function startBackend() {
  return new Promise((resolve, reject) => {
    child = utilityProcess.fork(path.join(__dirname, "backend.cjs"), [], {
      stdio: "pipe",
      serviceName: "Tinybuild example backend",
    });
    child.stdout.on("data", (data) => process.stdout.write(data));
    child.stderr.on("data", (data) => process.stderr.write(data));
    const timer = setTimeout(() => {
      const error = Error(
        "Sidecar startup timed out. Restart the app to reconnect.",
      );
      reject(error);
      stopBackend(error);
    }, 5000);
    child.on("message", (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "ready") {
        clearTimeout(timer);
        resolve();
        return;
      }
      const job = pending.get(message.id);
      if (!job) return;
      pending.delete(message.id);
      clearTimeout(job.timer);
      if (message.error) job.reject(Error(message.error));
      else job.resolve({ result: message.result, pid: message.pid });
    });
    child.on("exit", (code) => {
      exited = true;
      clearTimeout(timer);
      const error = Error(
        "Sidecar stopped (" + code + "). Restart the app to reconnect.",
      );
      backendError ||= error;
      reject(error);
      fail(backendError);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
      stopBackend(error);
    });
  });
}
function calculate(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000)
    return Promise.reject(Error("Use an integer from 0 to 1000000"));
  if (backendError || exited || stopping)
    return Promise.reject(backendError || Error("Sidecar is unavailable"));
  return new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => {
      // Stop a stuck backend and reject all requests, including this one.
      stopBackend(
        Error("Sidecar request timed out. Restart the app to reconnect."),
      );
    }, 3000);
    pending.set(id, { resolve, reject, timer });
    try {
      child.postMessage({ id, value });
    } catch (error) {
      stopBackend(error);
    }
  });
}
app
  .whenReady()
  .then(async () => {
    await startBackend();
    ipcMain.handle("sidecar:calculate", (event, value) => {
      if (event.sender !== window?.webContents) throw Error("Unknown renderer");
      return calculate(value);
    });
    window = new BrowserWindow({
      width: 900,
      height: 650,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const url = !app.isPackaged && process.env.TINYBUILD_DEV_URL;
    if (url) await window.loadURL(url);
    else await window.loadFile(path.join(__dirname, "web/index.html"));
  })
  .catch((error) => {
    dialog.showErrorBox("Sidecar startup failed", error.message);
    app.quit();
  });
// Closing the last window closes this demo on every platform.
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (exited || !child) return;
  event.preventDefault();
  if (stopping) return;
  stopping = true;
  fail(Error("App is closing"));
  const timer = setTimeout(() => child.kill(), 1500);
  child.once("exit", () => {
    clearTimeout(timer);
    app.quit();
  });
  try {
    child.postMessage({ type: "shutdown" });
  } catch {
    child.kill();
  }
});
