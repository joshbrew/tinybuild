const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const definition = path.join(__dirname, "tinybuild-app.json");
const config = fs.existsSync(definition)
  ? JSON.parse(fs.readFileSync(definition, "utf8"))
  : {};
if (config.id) app.setAppUserModelId(config.id);
function createWindow() {
  const developmentURL = !app.isPackaged && process.env.TINYBUILD_DEV_URL;
  const window = new BrowserWindow({
    title: config.name || "Tinybuild App",
    ...(config.icon ? { icon: path.resolve(__dirname, config.icon) } : {}),
    width: 800,
    height: 600,
    ...config.window,
    webPreferences: {
      preload: path.join(__dirname, "electron_preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (developmentURL) window.loadURL(developmentURL);
  else window.loadFile(path.join(__dirname, "web", "index.html"));
  if (!app.isPackaged && config.devtools)
    window.webContents.openDevTools({ mode: "detach" });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
