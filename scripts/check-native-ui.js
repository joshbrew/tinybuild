import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { _electron } from "playwright-core";
import { packager } from "../tinybuild/packager.js";

const repository = fileURLToPath(new URL("../", import.meta.url));
export function electronExecutable() {
  for (const directory of [
    ".test-native/runtime",
    "examples/native_profiles/electron",
    "examples/native_profiles",
    ".",
  ])
    try {
      return createRequire(path.join(repository, directory, "package.json"))(
        "electron",
      );
    } catch {}
  throw new Error(
    "Install the optional UI-test runtime with: npm install --prefix .test-native/runtime electron",
  );
}

export async function checkElectronUI({
  executablePath = electronExecutable(),
  launch = _electron.launch.bind(_electron),
} = {}) {
  const cwd = path.join(repository, ".test-native/ui");
  const results = path.join(repository, ".test-native/results");
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(results, { recursive: true });
  for (const filename of ["index.js", "index.html"])
    await fs.copyFile(
      path.join(repository, "examples/desktop_debug", filename),
      path.join(cwd, filename),
    );
  await fs.writeFile(
    path.join(cwd, "package.json"),
    '{"private":true,"type":"module"}',
  );
  const app = await packager(
    {
      build: true,
      server: false,
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
      },
      electron: { action: "stage" },
    },
    { cwd },
  );
  let desktop;
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.TINYBUILD_DEV_URL;
    desktop = await launch({
      executablePath,
      args: [path.join(cwd, "electron")],
      env,
      timeout: 30000,
    });
    const page = await desktop.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForFunction(
      () =>
        document.querySelector("output")?.textContent === "Desktop count: 0",
    );
    await page.getByRole("button", { name: "Increment", exact: true }).click();
    assert.equal(
      await page.locator("output").textContent(),
      "Desktop count: 1",
    );
    const security = await desktop.evaluate(({ BrowserWindow }) => {
      const options =
        BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return {
        contextIsolation: options.contextIsolation,
        sandbox: options.sandbox,
        nodeIntegration: options.nodeIntegration,
      };
    });
    assert.deepEqual(security, {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(results, "electron-ui.png") });
    const result = {
      target: "electron",
      status: "passed",
      security,
      version: await desktop.evaluate(() => process.versions.electron),
    };
    await fs.writeFile(
      path.join(results, "electron-ui.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    return result;
  } finally {
    try {
      await desktop?.close();
    } finally {
      await app.close();
    }
  }
}

export async function checkTauriUI({
  application,
  endpoint = "http://127.0.0.1:4444",
  request = fetch,
} = {}) {
  if (!application || !path.isAbsolute(application))
    throw new Error(
      "Pass an absolute Tauri executable path with --application",
    );
  const base = new URL(endpoint);
  if (!["http:", "https:"].includes(base.protocol))
    throw new Error("WebDriver endpoint must use HTTP(S)");
  async function command(method, pathname, body) {
    const response = await request(new URL(pathname, base), {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || data.value?.error)
      throw new Error(data.value?.message || "Native WebDriver request failed");
    return data;
  }
  const created = await command("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application } } },
  });
  const id = created.sessionId || created.value?.sessionId;
  if (!id) throw new Error("Native WebDriver did not return a session");
  const session = "/session/" + encodeURIComponent(id);
  try {
    const start = Date.now();
    while (
      (
        await command("POST", session + "/execute/sync", {
          script: 'return document.querySelector("output")?.textContent',
          args: [],
        })
      ).value !== "Desktop count: 0"
    ) {
      if (Date.now() - start > 15000)
        throw new Error("Tauri window did not render the desktop demo");
      await pause(100);
    }
    const element = (
      await command("POST", session + "/element", {
        using: "css selector",
        value: "button",
      })
    ).value;
    const elementId =
      element["element-6066-11e4-a52e-4f735466cecf"] || element.ELEMENT;
    await command(
      "POST",
      session + "/element/" + encodeURIComponent(elementId) + "/click",
      {},
    );
    assert.equal(
      (
        await command("POST", session + "/execute/sync", {
          script: 'return document.querySelector("output").textContent',
          args: [],
        })
      ).value,
      "Desktop count: 1",
    );
    return { target: "tauri", status: "passed", application };
  } finally {
    await command("DELETE", session);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const value = (name) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const result = args.includes("--tauri")
    ? await checkTauriUI({
        application: value("--application"),
        endpoint: value("--webdriver"),
      })
    : await checkElectronUI({ executablePath: value("--electron-executable") });
  console.log(JSON.stringify(result, null, 2));
}
