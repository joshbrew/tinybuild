// Opt-in real native checks. Ordinary example tests only stage these apps.
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { chromium, _electron } from "playwright-core";
import { packager } from "../tinybuild/packager.js";
import { loadConfig, mergeConfig } from "../tinybuild/config.js";
import { terminateChild } from "../tinybuild/process.js";
import { electronExecutable } from "./check-native-ui.js";
import { installNSIS } from "./installer-smoke.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const tauri = process.argv.includes("--tauri"),
  installer = process.argv.includes("--installer"),
  packaged = process.argv.includes("--packaged"),
  release = process.argv.includes("--release") || packaged || installer,
  crash = process.argv.includes("--crash");
if (tauri && packaged)
  throw Error("Use --tauri --release for the Tauri distribution check");
if (installer && !tauri)
  throw Error(
    "The installer check currently uses --tauri on a disposable Windows host",
  );
if (tauri && process.platform !== "win32")
  throw Error(
    "This Tauri UI checker uses Windows WebView2; use the WebDriver checker on other supported hosts.",
  );
const target = tauri ? "tauri" : "electron",
  mode =
    (installer
      ? "installer"
      : packaged
        ? "packaged"
        : release
          ? "release"
          : "dev") + (crash ? "-crash" : "");
const cwd = path.join(root, ".test-native/sidecars", target + "-" + mode);
const source = path.join(root, "examples", target + "_sidecar");
await fs.mkdir(cwd, { recursive: true });
await fs.cp(source, cwd, {
  recursive: true,
  filter: (filename) =>
    !path
      .relative(source, filename)
      .split(path.sep)
      .some((part) =>
        [
          "node_modules",
          "dist",
          "electron",
          "src-tauri",
          ".tinybuild",
        ].includes(part),
      ),
});
const config = await loadConfig("tinybuild.config.js", source);
const results = path.join(root, ".test-native/results");
await fs.mkdir(results, { recursive: true });
const signal = new AbortController();
const stop = () => signal.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
async function until(fn, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!(await fn())) {
    if (signal.signal.aborted) throw Error("Native check cancelled");
    if (Date.now() > deadline) throw Error("Native check timed out");
    await pause(100);
  }
}
async function freePort() {
  const s = net.createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
let app, browser, desktop, child, pending, page, pid, installed;
const errors = [];
let startupError,
  finished = false;
try {
  if (tauri) {
    const port = await freePort();
    const env = {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: path.join(cwd, "webview-data"),
    };
    if (release) {
      app = await packager(
        {
          ...config,
          build: true,
          server: false,
          tauri: {
            action: "build",
            noBundle: !installer,
            ...(installer ? { bundles: ["nsis"] } : {}),
          },
          native: mergeConfig(
            { ...config.native, env },
            installer
              ? {
                  tauri: {
                    bundle: {
                      windows: { nsis: { installMode: "currentUser" } },
                    },
                  },
                }
              : {},
          ),
        },
        { cwd, signal: signal.signal },
      );
      let executable = path.resolve(
        cwd,
        process.env.CARGO_TARGET_DIR || "src-tauri/target",
        "release/tinybuild-sidecar-example.exe",
      );
      if (installer) {
        const directory = path.join(path.dirname(executable), "bundle", "nsis");
        const candidates = (await fs.readdir(directory)).filter((file) =>
          file.endsWith(".exe"),
        );
        assert.equal(
          candidates.length,
          1,
          "One installer from this isolated build",
        );
        installed = await installNSIS({
          installer: path.join(directory, candidates[0]),
          directory: path.join(cwd, "installed app"),
          executable: path.basename(executable),
          signal: signal.signal,
        });
        executable = installed.executable;
        // The installed app/sidecar must not discover Node, Rust or Cargo via PATH.
        for (const key of Object.keys(env))
          if (["path", "node_path"].includes(key.toLowerCase()))
            delete env[key];
        env.PATH = path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
        );
      }
      child = spawn(executable, [], {
        env,
        windowsHide: true,
        stdio: "ignore",
      });
      child.on("error", (error) => errors.push(error.message));
    } else {
      pending = packager(
        {
          ...config,
          server: { host: "127.0.0.1", port: 0, delay: 150 },
          tauri: { action: "dev", liveReload: true, watch: false },
          native: { ...config.native, env },
        },
        {
          cwd,
          signal: signal.signal,
          onReady: (controller) => {
            app = controller;
          },
        },
      );
      pending.then(
        () => {
          finished = true;
        },
        (error) => {
          startupError = error;
        },
      );
    }
    await until(async () => {
      if (startupError) throw startupError;
      if (finished || (child && child.exitCode !== null))
        throw Error("Tauri exited before its window was ready");
      if (errors.length) throw Error(errors[0]);
      try {
        return (
          await fetch(`http://127.0.0.1:${port}/json/version`, {
            signal: AbortSignal.timeout(500),
          })
        ).ok;
      } catch {
        return false;
      }
    }, 600000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    await until(() => {
      page = browser
        .contexts()[0]
        .pages()
        .find((candidate) => candidate.url() !== "about:blank");
      return !!page;
    });
  } else {
    app = await packager(
      {
        ...config,
        build: release,
        server: release ? false : { host: "127.0.0.1", port: 0, delay: 150 },
        electron: packaged
          ? {
              action: "package",
              name: "TinybuildSidecar",
              outdir: "release",
              platform: process.platform,
              arch: process.arch,
            }
          : { action: "stage" },
      },
      { cwd, signal: signal.signal },
    );
    const packagedRoot = path.join(
      cwd,
      `release/TinybuildSidecar-${process.platform}-${process.arch}`,
    );
    const executablePath = packaged
      ? path.join(
          packagedRoot,
          process.platform === "darwin"
            ? "TinybuildSidecar.app/Contents/MacOS/TinybuildSidecar"
            : "TinybuildSidecar" + (process.platform === "win32" ? ".exe" : ""),
        )
      : electronExecutable();
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.TINYBUILD_DEV_URL;
    if (!release) env.TINYBUILD_DEV_URL = app.server.url;
    desktop = await _electron.launch({
      executablePath,
      args: packaged ? [] : [path.join(cwd, "electron")],
      env,
    });
    page = await desktop.firstWindow();
  }
  page.on("pageerror", (error) => errors.push(error.message));
  if (packaged)
    assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), true);
  await page.waitForFunction(
    () => document.querySelector("output")?.dataset.result === "49",
  );
  pid = Number(await page.locator("output").getAttribute("data-pid"));
  assert.ok(pid > 0);
  process.kill(pid, 0);
  await page.locator("input").fill("12");
  await page.getByRole("button").click();
  await page.waitForFunction(
    () => document.querySelector("output").dataset.result === "144",
  );
  assert.equal(
    Number(await page.locator("output").getAttribute("data-pid")),
    pid,
  );
  const rejected = await page.evaluate(async () => {
    try {
      if (globalThis.sidecar) await globalThis.sidecar.calculate(-1);
      else await globalThis.__TAURI__.core.invoke("calculate", { value: -1 });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true);
  let reloads = 0;
  if (!release) {
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) reloads++;
    });
    const script = await fs.readFile(path.join(cwd, "index.js"), "utf8");
    const html = await fs.readFile(path.join(cwd, "index.html"), "utf8");
    await Promise.all([
      fs.writeFile(
        path.join(cwd, "index.js"),
        script + '\ndocument.body.dataset.saved="yes";\n',
      ),
      fs.writeFile(
        path.join(cwd, "index.html"),
        html.replace("<h1>", '<h1 data-saved="yes">'),
      ),
    ]);
    await page.waitForFunction(
      () =>
        document.body.dataset.saved === "yes" &&
        document.querySelector("output").dataset.result === "49",
    );
    await pause(500);
    assert.equal(reloads, 1);
    assert.equal(
      Number(await page.locator("output").getAttribute("data-pid")),
      pid,
      "Frontend reload preserves the backend process",
    );
  }
  await page.screenshot({
    path: path.join(results, `sidecar-${target}-${mode}.png`),
  });
  assert.deepEqual(errors, []);
  const report = {
    target,
    mode,
    platform: process.platform,
    status: "passed",
    backendPid: pid,
    multiFileSaveReloads: reloads,
    invalidInputRejected: rejected,
    rendererErrors: errors,
  };
  let nativeParent;
  if (tauri) {
    const result = await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').ParentProcessId`,
      ],
      { windowsHide: true },
    );
    nativeParent = Number(result.stdout.trim());
    assert.ok(Number.isSafeInteger(nativeParent) && nativeParent > 0);
  }
  if (crash) {
    // Kill only the backend whose PID this owned demo returned over private IPC.
    process.kill(pid);
    await until(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const failure = await page.evaluate(async () => {
        try {
          if (globalThis.sidecar) await globalThis.sidecar.calculate(7);
          else
            await globalThis.__TAURI__.core.invoke("calculate", { value: 7 });
          return "";
        } catch (error) {
          return String(error);
        }
      });
      assert.match(
        failure,
        /stopped|unavailable|pipe|broken|closed|timed out/i,
      );
    }
    report.backendCrashRejected = true;
  }
  if (desktop) {
    await desktop.close();
    desktop = undefined;
  } else {
    // Close the native window, rather than only its WebView debugging target.
    // The backend's direct parent is this demo's Tauri process.
    await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `if (-not (Get-Process -Id ${nativeParent}).CloseMainWindow()) { throw 'Could not close the native sidecar window' }`,
      ],
      { windowsHide: true },
    );
    await browser.close();
    browser = undefined;
  }
  await until(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  });
  await app?.close();
  await pending?.catch((error) => {
    if (!/abort|closed|failed/i.test(error.message)) throw error;
  });
  report.backendStopped = true;
  if (installed) {
    await installed.close();
    report.installedAndUninstalled = true;
  }
  await fs.writeFile(
    path.join(results, `sidecar-${target}-${mode}.json`),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  signal.abort();
  await Promise.allSettled([
    desktop?.close(),
    browser?.close(),
    child && terminateChild(child),
    app?.close(),
  ]);
  await pending?.catch(() => {});
  await installed?.close();
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
