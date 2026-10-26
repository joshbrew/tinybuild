const { contextBridge, ipcRenderer } = require("electron");
// Expose one operation, rather than arbitrary process or filesystem access.
contextBridge.exposeInMainWorld("sidecar", {
  calculate: (value) => ipcRenderer.invoke("sidecar:calculate", value),
});
