import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { bundle } from "../tinybuild/esbuild/bundler.js";
import { fixture } from "./helpers.js";
import { packager } from "../tinybuild/packager.js";

test("mixed HTML/CSS/source saves reload once and static saves cannot hide build errors", async (t) => {
  const javascript = "document.body.dataset.ready='yes';";
  const pageHTML = (heading) =>
    `<html><head><link rel="stylesheet" href="/plain.css"></head><body><h1>${heading}</h1><script src="/dist/index.js"></script></body></html>`;
  const cwd = await fixture(t, {
    "index.js": javascript,
    "index.html": pageHTML("before"),
    "plain.css": "body{color:red}",
  });
  let errors = 0;
  const app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        minify: true,
        autoInstall: false,
        logLevel: "silent",
      },
      server: { host: "127.0.0.1", port: 0, delay: 100 },
    },
    { cwd, onError: () => errors++ },
  );
  t.after(() => app.close());
  const browser = await chromium.launch(
    process.env.TINYBUILD_BROWSER
      ? { executablePath: process.env.TINYBUILD_BROWSER, headless: true }
      : process.platform === "win32"
        ? { channel: "chrome", headless: true }
        : { headless: true },
  );
  t.after(() => browser.close());
  const page = await browser.newPage();
  let loads = 0;
  page.on("load", () => loads++);
  await page.goto(app.server.url);
  await page.waitForFunction(() => document.body.dataset.ready === "yes");
  await page.waitForTimeout(100);
  await fs.writeFile(
    path.join(cwd, "index.js"),
    javascript + " // same output",
  );
  await fs.writeFile(path.join(cwd, "index.html"), pageHTML("after"));
  await fs.writeFile(path.join(cwd, "plain.css"), "body{color:blue}");
  await page.waitForFunction(
    () =>
      document.querySelector("h1")?.textContent === "after" &&
      getComputedStyle(document.body).color === "rgb(0, 0, 255)",
  );
  await page.waitForLoadState("load");
  assert.equal(loads, 2);
  await fs.writeFile(path.join(cwd, "index.js"), "const = broken;");
  await page.locator("#__tinybuild_error").waitFor();
  const previous = errors;
  await fs.writeFile(path.join(cwd, "plain.css"), "body{color:green}");
  await page.waitForFunction(() =>
    document.querySelector("#__tinybuild_error"),
  );
  const start = Date.now();
  while (errors === previous && Date.now() - start < 5000)
    await page.waitForTimeout(20);
  assert.ok(errors > previous);
  assert.equal(await page.locator("#__tinybuild_error").count(), 1);
  await fs.writeFile(path.join(cwd, "index.js"), javascript);
  await page.waitForFunction(
    () =>
      !document.querySelector("#__tinybuild_error") &&
      getComputedStyle(document.body).color === "rgb(0, 128, 0)",
  );
  assert.equal(loads, 2, "Recover plain CSS without another page navigation");
});

test(
  "portable HTML runs an embedded worker, imported WASM, CSS and image from a file URL",
  { timeout: 30000 },
  async (t) => {
    const root = await fixture(t, {
      "index.js":
        'import url from "./task.worker";import icon from "./icon.svg";import "./style.css";document.body.innerHTML="<img id=icon><output>waiting</output>";document.querySelector("#icon").src=icon;const worker=new Worker(url);worker.onmessage=event=>{document.querySelector("output").textContent=event.data;worker.terminate();};worker.onerror=event=>{document.querySelector("output").textContent=event.message;};worker.postMessage(21);',
      "task.worker.js":
        'import wasm from "./empty.wasm";import {double} from "./shared.js";self.onmessage=async event=>{await WebAssembly.instantiate(await (await fetch(wasm)).arrayBuffer());self.postMessage(double(event.data)+":wasm");};',
      "shared.js": "export const double=value=>value*2;",
      "empty.wasm": Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
      "icon.svg":
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>',
      "style.css": "body{background-color:rgb(240,250,240)}",
    });
    const [result] = await bundle({
      absWorkingDir: root,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      bundleHTML: true,
      blobWorkers: false,
      autoInstall: false,
    });
    const portable = path.join(root, "portable # demo.html");
    await fs.copyFile(result.browser.html, portable);
    // Remove every build/source dependency before opening the remaining HTML.
    const buildDirectory = path.join(root, "dist");
    if (path.dirname(buildDirectory) !== root)
      throw new Error("Unsafe fixture cleanup");
    await fs.rm(buildDirectory, { recursive: true, force: true });
    const executablePath = process.env.TINYBUILD_BROWSER;
    const browser = await chromium.launch(
      executablePath
        ? { executablePath, headless: true }
        : process.platform === "win32"
          ? { channel: "chrome", headless: true }
          : { headless: true },
    );
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const external = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) external.push(request.url());
    });
    await page.goto(pathToFileURL(portable).href);
    await page.waitForFunction(
      () => document.querySelector("output")?.textContent === "42:wasm",
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#icon")?.complete &&
        document.querySelector("#icon")?.naturalWidth > 0,
    );
    assert.equal(
      await page
        .locator("#icon")
        .evaluate((image) => image.complete && image.naturalWidth > 0),
      true,
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((body) => getComputedStyle(body).backgroundColor),
      "rgb(240, 250, 240)",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  },
);

test("portable module workers nest and fetch declared runtime assets without companion files", async (t) => {
  let browser;
  t.after(() => browser?.close());
  const root = await fixture(t, {
    "index.js":
      'import {createWorker} from "./outer.Worker";document.body.innerHTML="<output>waiting</output>";const worker=createWorker();worker.onmessage=({data})=>{document.querySelector("output").textContent=data;worker.terminate();};worker.postMessage(21);',
    "outer.Worker.ts":
      'import {createWorker} from "./leaf.worker";const leaf=createWorker();leaf.onmessage=({data})=>{postMessage(data);leaf.terminate();};onmessage=({data})=>leaf.postMessage(data);',
    "leaf.worker":
      'import url from "tinybuild:asset/settings";onmessage=async({data})=>{const {multiplier}=await(await fetch(url)).json();postMessage(data*multiplier);};',
    "settings.json": '{"multiplier":2}',
  });
  const [group] = await bundle({
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    bundleHTML: true,
    blobWorkers: false,
    workerType: "module",
    runtimeAssets: { settings: "settings.json" },
    autoInstall: false,
  });
  const standalone = path.join(root, "standalone.html");
  await fs.copyFile(group.browser.html, standalone);
  const outputDirectory = path.join(root, "dist");
  if (path.dirname(outputDirectory) !== root)
    throw new Error("Unsafe test cleanup");
  await fs.rm(outputDirectory, { recursive: true, force: true });
  browser = await chromium.launch(
    process.env.TINYBUILD_BROWSER
      ? { executablePath: process.env.TINYBUILD_BROWSER, headless: true }
      : process.platform === "win32"
        ? { channel: "chrome", headless: true }
        : { headless: true },
  );
  const page = await browser.newPage();
  const errors = [],
    network = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await page.goto(pathToFileURL(standalone).href);
  await page.waitForFunction(
    () => document.querySelector("output")?.textContent === "42",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
});

test("hashed portable pages run offline with isolated CSS, dynamic imports, worker assets and reusable blob URLs", async (t) => {
  const root = await fixture(t, {
    "a.js": 'import "./a.css";import {run} from "./app.js";run("a");',
    "b.js": 'import "./b.css";import {run} from "./app.js";run("b");',
    "a.css":
      'body{color:rgb(255,0,0);background-image:url("./icon.svg")}body::after{content:"</style>"}',
    "b.css":
      'body{color:rgb(0,0,255);background-image:url("./icon.svg")}body::after{content:"</style>"}',
    "app.js": `import {createWorker,revokeWorkerURL} from "./task.Worker";
      export async function run(name){
        document.body.dataset.page=name;
        document.body.dataset.literal="</script> <!-- <script>";
        document.body.innerHTML="<output>waiting</output>";
        const {value}=await import("./lazy.js");
        const answers=[];
        for(let i=0;i<3;i++){
          const worker=createWorker();
          answers.push(await new Promise((resolve,reject)=>{worker.onmessage=({data})=>resolve(data);worker.onerror=reject;worker.postMessage(value);}));
          worker.terminate();revokeWorkerURL();
        }
        document.querySelector("output").textContent=answers.join("|");
      }`,
    "lazy.js": "export const value=21;",
    "task.Worker.ts":
      'import url from "./payload.custom";onmessage=async({data})=>postMessage(data*2+":"+await(await fetch(url)).text());',
    "payload.custom": "portable worker asset",
    "icon.svg":
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>',
  });
  const [group] = await bundle({
    absWorkingDir: root,
    entryPoints: ["a.js", "b.js"],
    outdir: "dist",
    entryNames: "[name]-[hash]",
    bundleHTML: true,
    bundleGzip: true,
    blobWorkers: false,
    workerType: "module",
    workerBundler: { loader: { ".custom": "copy" } },
    autoInstall: false,
  });
  const destination = await fixture(t);
  const pages = [];
  for (const html of group.browser.htmlFiles) {
    const name = path.basename(html).slice(0, 1);
    const filename = path.join(destination, "portable # " + name + ".html");
    await fs.copyFile(html, filename);
    pages.push({ filename, name });
  }
  assert.equal(pages.length, 2);
  if (
    !path.basename(root).startsWith("tinybuild-test-") ||
    root === destination
  )
    throw new Error("Unsafe fixture cleanup");
  await fs.rm(root, { recursive: true, force: true });
  const browser = await chromium.launch(
    process.env.TINYBUILD_BROWSER
      ? { executablePath: process.env.TINYBUILD_BROWSER, headless: true }
      : process.platform === "win32"
        ? { channel: "chrome", headless: true }
        : { headless: true },
  );
  t.after(() => browser.close());
  const context = await browser.newContext({ offline: true });
  const errors = [],
    requests = [];
  context.on("request", (request) => requests.push(request.url()));
  for (const { filename, name } of pages) {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(filename).href);
    try {
      await page.waitForFunction(
        () =>
          document.querySelector("output")?.textContent ===
          Array(3).fill("42:portable worker asset").join("|"),
        undefined,
        { timeout: 5000 },
      );
    } catch (error) {
      assert.fail(
        JSON.stringify({
          errors,
          requests,
          body: await page.locator("body").innerHTML(),
        }) +
          "\n" +
          error.message,
      );
    }
    assert.equal(await page.locator("body").getAttribute("data-page"), name);
    assert.equal(
      await page.locator("body").getAttribute("data-literal"),
      "</script> <!-- <script>",
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((body) => getComputedStyle(body).color),
      name === "a" ? "rgb(255, 0, 0)" : "rgb(0, 0, 255)",
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((body) => getComputedStyle(body, "::after").content),
      '"</style>"',
    );
    assert.match(
      await page
        .locator("body")
        .evaluate((body) => getComputedStyle(body).backgroundImage),
      /^url\("?data:image\/svg\+xml/,
    );
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(
    requests.filter(
      (url) =>
        !url.startsWith("data:") &&
        !url.startsWith("blob:") &&
        !pages.some(({ filename }) => url === pathToFileURL(filename).href),
    ),
    [],
  );
});

test("script reload awaits disposal, preserves state and installs each listener once", async (t) => {
  let browser, app;
  t.after(async () => {
    await browser?.close();
    await app?.close();
  });
  const hotModule = new URL("../tinybuild/client/hot.js", import.meta.url);
  const source = (label) =>
    'import {createHotContext} from "tinybuild/client/hot";const hot=createHotContext("counter");let count=hot.data.count||0;const button=document.querySelector("button");const render=()=>document.querySelector("output").textContent="' +
    label +
    ':"+count;const increment=()=>{count++;render();};button.addEventListener("click",increment);hot.dispose(async data=>{await new Promise(resolve=>setTimeout(resolve,10));data.count=count;button.removeEventListener("click",increment);});hot.accept(()=>{document.body.dataset.accepted="yes";});render();';
  const root = await fixture(t, {
    "index.js": source("before"),
    "other.js":
      'import {createHotContext} from "tinybuild/client/hot";const hot=createHotContext("counter");let count=hot.data.count||0;const button=document.querySelector("#other");const render=()=>document.querySelector("#other-count").textContent="Other:"+count;const increment=()=>{count++;render();};button.addEventListener("click",increment);hot.dispose(data=>{data.count=count;button.removeEventListener("click",increment);});render();',
    "index.html":
      '<button>Increment</button><output></output><button id="other">Other increment</button><output id="other-count"></output><script src="/dist/index.js"></script><script src="/dist/other.js"></script>',
  });
  app = await packager(
    {
      bundler: {
        absWorkingDir: root,
        entryPoints: ["index.js", "other.js"],
        outdir: "dist",
        sourcemap: false,
        alias: {
          "tinybuild/client/hot": (await import("node:url")).fileURLToPath(
            hotModule,
          ),
        },
        autoInstall: false,
      },
      server: {
        host: "127.0.0.1",
        port: 0,
        hotreload: true,
        reloadscripts: true,
      },
    },
    { watch: false },
  );
  browser = await chromium.launch(
    process.env.TINYBUILD_BROWSER
      ? { executablePath: process.env.TINYBUILD_BROWSER, headless: true }
      : process.platform === "win32"
        ? { channel: "chrome", headless: true }
        : { headless: true },
  );
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(app.server.url);
  await page.waitForFunction(
    () => document.querySelector("output")?.textContent === "before:0",
  );
  await page.getByRole("button", { name: "Increment", exact: true }).click();
  await page.getByRole("button", { name: "Other increment" }).click();
  await page.waitForFunction(
    () => document.querySelector("output")?.textContent === "before:1",
  );
  await fs.writeFile(path.join(root, "index.js"), source("after"));
  await app.rebuild(["index.js"]);
  await page.waitForFunction(
    () => document.querySelector("output")?.textContent === "after:1",
  );
  assert.equal(await page.locator("body").getAttribute("data-accepted"), "yes");
  await page.getByRole("button", { name: "Increment", exact: true }).click();
  await page.getByRole("button", { name: "Other increment" }).click();
  assert.equal(await page.locator("#other-count").textContent(), "Other:2");
  assert.equal(await page.locator("output").first().textContent(), "after:2");
  assert.deepEqual(errors, []);
});

test(
  "all browser demos execute and interactive examples work in Chromium",
  { timeout: 60000 },
  async (t) => {
    const browser = await chromium.launch(
      process.env.TINYBUILD_BROWSER
        ? { executablePath: process.env.TINYBUILD_BROWSER, headless: true }
        : process.platform === "win32"
          ? { channel: "chrome", headless: true }
          : { headless: true },
    );
    t.after(() => browser.close());
    const { checkExamples } = await import("../scripts/check-examples.js");
    const seen = [];
    await checkExamples({
      inspectPage: async ({ label, url }) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const errors = [];
          page.on("dialog", (dialog) => dialog.dismiss());
          page.on("pageerror", (error) => errors.push(error.message));
          const navigation = await page.goto(url, { waitUntil: "networkidle" });
          if (label.endsWith("/gzip_target")) {
            assert.equal(navigation.headers()["content-encoding"], "gzip");
            await page.getByRole("button", { name: "Try the app" }).click();
            assert.equal(
              await page.locator("output").textContent(),
              "Count: 1",
            );
          }
          if (label.endsWith("/desktop_debug")) {
            await page.getByRole("button").click();
            assert.equal(
              await page.locator("output").textContent(),
              "Desktop count: 1",
            );
          }
          if (label.endsWith("/server_workflow")) {
            await page.getByRole("button", { name: "Check readiness" }).click();
            await page.waitForFunction(
              () =>
                document.querySelector("output")?.textContent ===
                "Server is ready",
            );
            await page.getByRole("link", { name: "Try a deep link" }).click();
            await page.waitForFunction(
              () =>
                document.querySelector("output")?.textContent ===
                "Server is ready",
            );
          }
          if (label.endsWith("/native_lifecycle")) {
            assert.equal(
              await page.locator("output").textContent(),
              "Active / Online",
            );
            await page.getByRole("button").click();
            await page.waitForFunction(
              () =>
                document.querySelector("pre")?.textContent !==
                "Permission has not been checked",
            );
            await context.setOffline(true);
            await page.waitForFunction(
              () =>
                document.querySelector("output")?.textContent ===
                "Active / Offline",
            );
            await context.setOffline(false);
            await page.waitForFunction(
              () =>
                document.querySelector("output")?.textContent ===
                "Active / Online",
            );
          }
          if (label.endsWith("/worker_pool")) {
            await page.waitForFunction(
              () =>
                document.querySelector("output")?.textContent ===
                "Transferred result: 20, 40, 60",
            );
            await page.getByRole("button").click();
            await page.waitForFunction(
              () =>
                document.querySelector("output")?.textContent ===
                "Cancelled: AbortError",
            );
          }
          if (label.endsWith("/worker_types")) {
            await page.waitForFunction(
              () =>
                document.querySelector("output")?.textContent ===
                "Worker result: 42",
            );
            assert.match(
              await page.locator("output").getAttribute("data-worker-url"),
              /^blob:/,
            );
          }
          if (label.endsWith("/native_capabilities")) {
            await page.getByRole("button").click();
            await page.waitForFunction(
              () =>
                document.querySelector("output")?.textContent ===
                "Browser demo note saved",
            );
          }
          if (label.endsWith("/asset_copy"))
            await page.waitForFunction(() =>
              document
                .querySelector("output")
                ?.textContent.includes("Copied assets"),
            );
          if (label.endsWith("/proxy_ws_sse"))
            await page.waitForFunction(
              () =>
                document.querySelector("output")?.textContent ===
                "Echo through WebSocket proxy",
            );
          if (label.endsWith("/build_baseline")) {
            await page.getByRole("link").click();
            await page.getByRole("button").first().click();
            assert.match(
              await page.locator("#dependencies").textContent(),
              /index.js/,
            );
            await page.locator("#search").fill("does-not-exist");
            assert.equal(await page.locator("tbody tr").count(), 0);
          }
          if (label.endsWith("/webworkers"))
            await page.waitForFunction(() =>
              document.querySelector("pre")?.textContent.includes("HELLO"),
            );
          if (label.endsWith("/worker_files"))
            await page.waitForFunction(
              () => document.querySelector("pre")?.textContent === "42",
            );
          if (label.endsWith("/html_bundle"))
            await page.waitForFunction(() =>
              document.querySelector("pre")?.textContent.includes("42"),
            );
          if (label.endsWith("/nested_workers"))
            await page.waitForFunction(
              () =>
                document.querySelector("output")?.textContent ===
                "42: nested worker + embedded settings",
            );
          if (label.endsWith("/task_workspace"))
            await page.waitForFunction(() =>
              document
                .querySelector("output")
                ?.textContent.includes("ready backend"),
            );
          if (label.endsWith("/hot_hooks")) {
            await page.getByRole("button").click();
            assert.equal(
              await page.locator("output").textContent(),
              "Count: 1",
            );
          }
          if (label.endsWith("/sharedarraybuffers"))
            await page.waitForFunction(() =>
              document
                .querySelector("pre")
                ?.textContent.includes("Transfer worker returned"),
            );
          if (label.endsWith("/asset_pipeline")) {
            await page.getByRole("button").click();
            await page.waitForFunction(() =>
              document
                .querySelector("output")
                ?.textContent.includes("separate chunk"),
            );
          }
          if (label.endsWith("/spa")) {
            await page.getByRole("link").click();
            await page.reload();
            assert.match(
              await page.locator("main").textContent(),
              /dashboard\/settings/,
            );
          }
          if (label.endsWith("/multi_page")) {
            await page.getByRole("link", { name: "About" }).click();
            await page.waitForFunction(() =>
              document.querySelector("output")?.textContent.includes("About"),
            );
          }
          if (label.endsWith("/api_proxy"))
            await page.waitForFunction(() =>
              document
                .querySelector("output")
                ?.textContent.includes("proxied backend"),
            );
          if (label.endsWith("/pwa")) {
            await page.evaluate(() => navigator.serviceWorker.ready);
            await page.waitForFunction(
              () => navigator.serviceWorker.controller,
            );
            await context.setOffline(true);
            await page.reload();
            assert.match(
              await page.locator("body").textContent(),
              /Offline-capable HTML/,
            );
          }
          assert.deepEqual(errors, [], label);
          seen.push(label);
        } finally {
          await context.close();
        }
      },
    });
    assert.ok(seen.length >= 16);
  },
);

test("SSE reload updates real browser pages and recovers from build errors", async (t) => {
  let app, browser;
  t.after(async () => {
    await browser?.close();
    await app?.close();
  });
  const cwd = await fixture(t, {
    "index.js": 'document.querySelector("output").textContent="before";',
    "index.html": '<output></output><script src="dist/index.js"></script>',
  });
  app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
        logLevel: "silent",
      },
      server: { host: "127.0.0.1", port: 0, hotreloadTransport: "sse" },
    },
    { cwd, watch: false },
  );
  browser = await chromium.launch(
    process.env.TINYBUILD_BROWSER
      ? { executablePath: process.env.TINYBUILD_BROWSER, headless: true }
      : process.platform === "win32"
        ? { channel: "chrome", headless: true }
        : { headless: true },
  );
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(app.server.url);
  await page.waitForFunction(
    () => document.querySelector("output")?.textContent === "before",
  );
  await fs.writeFile(path.join(cwd, "index.js"), "const = ;");
  await assert.rejects(app.rebuild());
  await page.waitForFunction(() =>
    document.getElementById("__tinybuild_error"),
  );
  await fs.writeFile(
    path.join(cwd, "index.js"),
    'document.querySelector("output").textContent="after";',
  );
  await app.rebuild();
  await page.waitForFunction(
    () => document.querySelector("output")?.textContent === "after",
  );
  assert.equal(await page.locator("#__tinybuild_error").count(), 0);
  assert.deepEqual(errors, []);
});

test("desktop development CSP permits live reload and imported WebAssembly in Chromium", async (t) => {
  let app, browser;
  t.after(async () => {
    await browser?.close();
    await app?.close();
  });
  const source = (label) =>
    'WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0])).then(()=>document.querySelector("output").textContent="' +
    label +
    '");';
  const root = await fixture(t, {
    "index.js": source("before"),
    "index.html": '<output></output><script src="dist/index.js"></script>',
  });
  app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
      },
      server: { host: "127.0.0.1", port: 0 },
      tauri: { action: "dev", liveReload: true },
    },
    { cwd: root, watch: false, native: { dryRun: true } },
  );
  const overlay = JSON.parse(
    await fs.readFile(app.native.config.tauriFile, "utf8"),
  );
  const csp = overlay.app.security.devCsp;
  assert.match(csp, /ipc:/);
  assert.match(csp, /wasm-unsafe-eval/);
  await fs.writeFile(
    path.join(root, "index.html"),
    '<meta http-equiv="Content-Security-Policy" content="' +
      csp +
      '"><output></output><script src="dist/index.js"></script>',
  );
  browser = await chromium.launch(
    process.env.TINYBUILD_BROWSER
      ? { executablePath: process.env.TINYBUILD_BROWSER, headless: true }
      : process.platform === "win32"
        ? { channel: "chrome", headless: true }
        : { headless: true },
  );
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(app.server.url);
  await page.waitForFunction(
    () => document.querySelector("output")?.textContent === "before",
  );
  await fs.writeFile(path.join(root, "index.js"), source("after"));
  await app.rebuild();
  await page.waitForFunction(
    () => document.querySelector("output")?.textContent === "after",
  );
  assert.deepEqual(errors, []);
});

test("reload clients recover fresh content after a server config restart on the same port", async (t) => {
  for (const transport of ["ws", "sse"]) {
    let app, browser;
    const definition = (label) => ({
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
        define: { LABEL: JSON.stringify(label) },
      },
      server: {
        host: "127.0.0.1",
        port: 0,
        hotreloadTransport: transport,
        headers: { "X-Revision": label },
      },
    });
    const root = await fixture(t, {
      "index.js": 'document.querySelector("output").textContent=LABEL;',
      "index.html": '<output></output><script src="dist/index.js"></script>',
      "tinybuild.config.mjs":
        "export default " + JSON.stringify(definition("before")),
    });
    try {
      app = await packager(definition("before"), {
        cwd: root,
        configPath: "tinybuild.config.mjs",
      });
      const url = app.server.url;
      browser = await chromium.launch(
        process.env.TINYBUILD_BROWSER
          ? { executablePath: process.env.TINYBUILD_BROWSER, headless: true }
          : process.platform === "win32"
            ? { channel: "chrome", headless: true }
            : { headless: true },
      );
      const page = await browser.newPage();
      await page.goto(url);
      await page.waitForFunction(
        () => document.querySelector("output")?.textContent === "before",
      );
      await page.waitForTimeout(100);
      await fs.writeFile(
        path.join(root, "tinybuild.config.mjs"),
        "export default " + JSON.stringify(definition("after")),
      );
      await page.waitForFunction(
        () => document.querySelector("output")?.textContent === "after",
      );
      assert.equal(app.server.url, url);
    } finally {
      await browser?.close();
      await app?.close();
    }
  }
});
