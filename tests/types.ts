import {
  packager,
  bundle,
  bundleBrowser,
  workerPlugin,
  serve,
  runAndWatch,
  nativeApp,
  selectNativeProfile,
  discoverDevices,
  developmentQR,
  analyzeBuild,
  benchmarkBuild,
  startTasks,
  remotePlan,
  startRemote,
  verifyMacRelease,
  checkMobileLifecycle,
  probeServer,
  type Config,
  checkProject,
  optionReference,
  listStarters,
  initStarter,
  scaffoldWorker,
  doctorReport,
} from "tinybuild";
import { createHotContext } from "tinybuild/client/hot";
import { watchAppLifecycle } from "tinybuild/client/native";
void bundle(
  {},
  {
    onProgress(progress) {
      const target: string = progress.target;
      const phase: "start" | "end" = progress.phase;
      const bytes: number | undefined = progress.outputs?.[0]?.bytes;
      void [target, phase, bytes];
    },
  },
);
void remotePlan({
  host: "mac-dev",
  command: ["npm", "start"],
  forwards: [{ local: 8080, remote: 8080 }],
});
void startRemote(
  { host: "windows-dev", platform: "windows", command: false },
  { dryRun: true },
);
void verifyMacRelease("Demo.app", { dryRun: true });
void checkMobileLifecycle({
  platform: "android",
  id: "com.example.demo",
  device: "test",
  artifact: "app.apk",
  dryRun: true,
  verify: async (checkpoint) => {
    const phase: string = checkpoint.phase;
    void phase;
  },
});
void probeServer("http://localhost:8080/_tinybuild/ready");
void watchAppLifecycle({
  onChange: (state) => {
    const online: boolean = state.online;
    void online;
  },
}).close();
const config: Config = {
  bundler: {
    entryPoints: ["src/main.ts"],
    outdir: "dist",
    bundleESM: true,
    bundleGzip: true,
    plugins: [workerPlugin({ blobWorkers: false })],
    workerBundler: { format: "esm" },
  },
  server: {
    precompressed: true,
    root: "public",
    routes: {
      "/hello/:name": {
        onrequest: async (req, res) => {
          res.end(req.params?.name);
          return true;
        },
      },
    },
  },
  electron: { action: "stage" },
};
void packager(config).then((app) => app.close());
void bundle({ entryPoints: ["index.js"], bundleCommonJS: true });
void bundleBrowser({ bundleGzip: true }).then((result) => {
  const files: string[] | undefined = result.gzipFiles;
  void files;
});
void serve({ port: 0 }).then((server) => server.close());
const supervised = runAndWatch("backend.js");
void supervised.ready.then(() => supervised.watcher.getWatched());
void supervised.close();
const native = nativeApp({
  id: "com.example.app",
  buildNumber: 2,
  icons: { mobile: "icons" },
  targets: { mobile: { android: { action: "run", target: "emulator-5554" } } },
  profiles: { release: { targets: { tauri: { action: "build" } } } },
});
void selectNativeProfile(native, "release");
void discoverDevices().then((devices) => devices.android[0]?.id);
void developmentQR("http://localhost:8080");
void bundle(config.bundler as import("tinybuild").BundlerConfig).then(
  (results) =>
    analyzeBuild(results, { budgets: { totalBytes: 1024, onExceed: "error" } }),
);
void benchmarkBuild({ entryPoints: ["index.js"] }, { iterations: 2 });
void startTasks({
  api: { command: "node", args: ["api.js"], ready: { stdout: "READY" } },
}).then((workspace) => workspace.close());
const hot = createHotContext<{ count?: number }>("counter");
hot.dispose((data) => {
  data.count = 1;
});
// @ts-expect-error Native actions are constrained.
const invalid: Config = { electron: { action: "typo" } };
void invalid;

import { createWorkerPool } from "tinybuild/client/workers";
import { createNativeBridge } from "tinybuild/client/native";
const pool = createWorkerPool<{ sum: { input: number[]; output: number } }>(
  () => new Worker("task.worker.js"),
);
void pool.run("sum", [1, 2]).then((value) => value.toFixed());
// @ts-expect-error Worker payloads follow the declared method contract.
void pool.run("sum", "wrong");
void pool.close();
const bridge = createNativeBridge<{ read: (key: string) => Promise<string> }>({
  web: { read: async (key) => key },
});
void bridge.call("read", "key");
const convenience: Config = {
  copy: [{ from: "public", to: "dist" }],
  strictConfig: true,
  diagnostics: {
    compression: true,
    baseline: "baseline.json",
    report: "dist/report.html",
  },
  budgets: { gzipBytes: 1000, growthBytes: 100 },
  native: { presets: ["camera", "files", "notifications"] },
  mobile: { android: { action: "run", liveReload: true, connection: "usb" } },
  server: {
    hotreloadTransport: "sse",
    proxy: { "/ws": { target: "http://localhost:8081", ws: true } },
  },
};
void convenience;

const desktopConfig: Config = {
  electron: {
    action: "open",
    liveReload: true,
    devtools: true,
    inspect: 0,
    args: ["--demo"],
    window: { width: 1100, minHeight: 400 },
  },
  tauri: { action: "build", debug: true, noBundle: true, features: ["demo"] },
  mobile: false,
};
void packager(desktopConfig).then((app) => app.native?.artifactDirectories);
void checkProject({
  bundler: false,
  checks: {
    files: ["dist/index.js"],
    urls: [{ path: "/", status: 200, includes: "Hello" }],
    timeout: 5000,
  },
});
void optionReference("worker").map((option) => option.type);
void listStarters("worker");
void initStarter("webworkers", { cwd: "demo", agentGuide: true });
void scaffoldWorker("src/flow.Worker", {
  typescript: true,
  runtime: "node",
  dryRun: true,
});
const support = doctorReport({ server: false });
console.log(support.runtime.esbuild, support.validation.errors);
void packager(
  { server: false },
  {
    onEvent: (event) => {
      const version: 1 = event.schemaVersion;
      console.log(version, event.type, event.url);
      if (event.type === "reload")
        console.log(event.action, event.files, event.services);
      if (event.type === "artifacts")
        console.log(event.artifacts?.[0]?.entries);
    },
  },
);
