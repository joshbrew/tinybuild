import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import { spawn } from "node:child_process";
import { once, EventEmitter } from "node:events";
import create, { writeMissing } from "./create.js";
import { getTemplateSync, getPath } from "./templates/get.js";
import { runPackageCommand, terminateChild } from "./process.js";
import { writeConfigEdits } from "./configure.js";
import { outputContext } from "./reporting.js";

export function copyFolderRecursiveSync(source, target) {
  fs.cpSync(source, path.join(target, path.basename(source)), {
    recursive: true,
    force: false,
  });
}
export function checkNodeModules(cwd = process.cwd()) {
  return fs.existsSync(path.join(cwd, "node_modules"))
    ? Promise.resolve()
    : runPackageCommand(["install"], { cwd });
}
export function checkTSConfig(cwd = process.cwd(), entry) {
  return create.tsconfig(path.join(cwd, "tsconfig.json"), undefined, entry);
}
export function checkConfig(
  filename = path.join(process.cwd(), "tinybuild.config.js"),
) {
  return create.config(filename);
}
export function checkBuildScript(cwd = process.cwd()) {
  return create.tinybuild(path.join(cwd, "tinybuild.js"));
}
export function checkCoreExists(cwd = process.cwd()) {
  fs.cpSync(path.resolve(getPath(""), ".."), path.join(cwd, "tinybuild"), {
    recursive: true,
    force: false,
  });
}

export async function checkBoilerPlate(
  config = {},
  onlyConfig = true,
  cwd = process.cwd(),
) {
  cwd = path.resolve(cwd);
  const bundler =
    (Array.isArray(config.bundler) ? config.bundler[0] : config.bundler) || {};
  const entries = bundler.entryPoints ||
    config.entryPoints || [config.entryFile || "index.js"];
  const first = Array.isArray(entries)
    ? entries[0]
    : typeof entries === "string"
      ? entries
      : Object.values(entries)[0];
  const entry = typeof first === "string" ? first : first?.in || "index.js";
  if (onlyConfig) checkConfig(path.join(cwd, "tinybuild.config.js"));
  else checkBuildScript(cwd);
  create.package(path.join(cwd, "package.json"));
  const entryPath = path.resolve(cwd, entry);
  const stylesheet = entryPath.replace(/\.[^.]+$/, ".css");
  const existingTS = entryPath.replace(/\.js$/, ".ts");
  if (!fs.existsSync(entryPath) && !fs.existsSync(existingTS)) {
    create.entry(entryPath, () =>
      getTemplateSync("index.js")
        .toString()
        .replace('"./index.css"', () =>
          JSON.stringify("./" + path.basename(stylesheet)),
        ),
    );
    writeMissing(stylesheet, getTemplateSync("index.css"));
  }
  if (config.server !== false) {
    const html = path.resolve(cwd, config.server?.startpage || "index.html");
    let output =
      bundler.outfile ||
      path.join(
        bundler.outdir || "dist",
        path.basename(entry, path.extname(entry)),
      );
    output = output.replace(/\.[cm]?js$/, "");
    const relative = path
      .relative(path.dirname(html), path.resolve(cwd, output))
      .split(path.sep)
      .join("/");
    const resource = relative.split("/").map(encodeURIComponent).join("/");
    writeMissing(
      html,
      getTemplateSync("index.html")
        .toString()
        .replaceAll("./dist/index", () => resource),
    );
  }
  create.gitignore(cwd);
  create.readme(cwd, () => {
    const files = [
      [entryPath, "App code"],
      [stylesheet, "Styles"],
      ...(config.server === false
        ? []
        : [
            [
              path.resolve(cwd, config.server?.startpage || "index.html"),
              "Page layout",
            ],
          ]),
      [path.join(cwd, "tinybuild.config.js"), "Build and server settings"],
    ].filter(([filename]) => fs.existsSync(filename));
    const table =
      "| File | Edit it for |\n| --- | --- |\n" +
      files
        .map(
          ([filename, description]) =>
            "| `" +
            path.relative(cwd, filename).split(path.sep).join("/") +
            "` | " +
            description +
            " |",
        )
        .join("\n");
    let readme = getTemplateSync("README.md")
      .toString()
      .replace(
        /^Follow the printed URL\..*$/m,
        () =>
          (config.server === false
            ? "Build once with `npm run build`; this setup does not start a web server."
            : "Follow the printed URL. Edit a source file and save to update the page. Stop development with Ctrl+C.") +
          "\n\n" +
          table,
      );
    if (config.server === false)
      readme = readme
        .replace(/npm install\r?\nnpm start/, "npm install\nnpm run build")
        .replace(/^\| Serve files I already built.*\r?\n/gm, "")
        .replace(
          "entry file, output path and server port",
          "entry file and output path",
        );
    return readme;
  });
  if (bundler.bundleTypes) checkTSConfig(cwd, entry);
}
export async function initRepo(
  dirName = "example",
  entryPoints = ["index.js"],
  initScript,
  config,
  includeCore = false,
) {
  const cwd = path.resolve(dirName);
  const entries = Array.isArray(entryPoints) ? entryPoints : [entryPoints];
  const settings = config || {
    bundler: {
      entryPoints: entries,
      outfile: "dist/" + path.basename(entries[0], path.extname(entries[0])),
      bundleBrowser: true,
    },
    server: { startpage: "index.html" },
  };
  fs.mkdirSync(cwd, { recursive: true });
  if (!fs.existsSync(path.join(cwd, "tinybuild.config.js")))
    await writeConfigEdits("tinybuild.config.js", settings, { cwd });
  if (initScript) create.entry(path.join(cwd, entries[0]), initScript);
  await checkBoilerPlate(settings, true, cwd);
  if (includeCore) {
    checkCoreExists(cwd);
    create.tinybuild(
      path.join(cwd, "tinybuild.js"),
      'import {packager} from "./tinybuild/packager.js"; import config from "./tinybuild.config.js"; await packager(config);\n',
    );
  }
  return cwd;
}

export function isWatchedFile(
  filename,
  { cwd = process.cwd(), ignore = [], extensions = [], watchPaths = [] } = {},
) {
  const absolute = path.resolve(cwd, filename);
  if (/\.tinybuild-gzip\.tmp$/.test(absolute)) return false;
  if (/^\.tinybuild-config-.*\.[cm]js$/.test(path.basename(absolute)))
    return false;
  if (
    ![cwd, ...watchPaths].some((root) => {
      const child = path.relative(path.resolve(cwd, root), absolute);
      return (
        child === "" ||
        (child !== ".." &&
          !child.startsWith(".." + path.sep) &&
          !path.isAbsolute(child))
      );
    })
  )
    return false;
  const relative = path.relative(cwd, absolute);
  if (
    relative
      .split(path.sep)
      .some((part) =>
        [
          "node_modules",
          ".git",
          ".temp",
          ".tinybuild",
          "android",
          "ios",
          "electron",
          "src-tauri",
          "mobile_dist",
        ].includes(part),
      )
  )
    return false;
  for (const value of ignore) {
    const ignored = path.resolve(cwd, value);
    const child = path.relative(ignored, absolute);
    if (
      child === "" ||
      (!child.startsWith(".." + path.sep) &&
        child !== ".." &&
        !path.isAbsolute(child))
    )
      return false;
  }
  return (
    !extensions.length ||
    extensions
      .map((extension) => extension.replace(/^\./, "").toLowerCase())
      .includes(path.extname(filename).slice(1).toLowerCase())
  );
}

export function runAndWatch(
  script,
  args = [],
  ignore = ["dist", ".temp", "package.json"],
  extensions = [
    "js",
    "mjs",
    "cjs",
    "ts",
    "css",
    "html",
    "jpg",
    "png",
    "txt",
    "csv",
    "jsx",
    "tsx",
    "scss",
    "vue",
    "less",
    "sass",
  ],
  restartDelay = 150,
  options = {},
) {
  const cwd = options.cwd || process.cwd();
  const controller = new EventEmitter();
  const spawnChild = options.spawn || spawn;
  const completedChildren = new WeakSet();
  let closed = false,
    running = false,
    dirty = false,
    timer;
  let pending = new Set();
  const childArgs = args === process.argv ? args.slice(2) : args;
  function launch(changes = []) {
    const child = spawnChild(
      options.command || process.execPath,
      [
        path.resolve(cwd, script),
        ...childArgs,
        ...(!options.command && changes.length
          ? ["--changed", changes.at(-1)]
          : []),
      ],
      {
        cwd,
        detached: process.platform !== "win32",
        windowsHide: true,
        env: options.env || process.env,
        stdio:
          options.ipc && !options.command
            ? [
                "ignore",
                outputContext.getStore()?.machine ? 2 : "inherit",
                "inherit",
                "ipc",
              ]
            : outputContext.getStore()?.machine
              ? ["inherit", 2, 2]
              : "inherit",
      },
    );
    controller.process = child;
    child.once("close", () => completedChildren.add(child));
    child.on("error", (error) => controller.emit("childError", error));
    child.on("message", (message) => controller.emit("message", message));
    child.once("exit", (code, signal) =>
      controller.emit("childExit", { code, signal }),
    );
    return child;
  }
  async function stop() {
    const child = controller.process;
    if (!child || completedChildren.has(child)) return;
    const realChild = typeof child.connected === "boolean";
    if (!realChild && (child.exitCode != null || child.signalCode)) return;
    const exited = once(child, realChild ? "close" : "exit").catch(() => {});
    if (child.connected) child.disconnect();
    if (child.exitCode == null && !child.signalCode)
      await terminateChild(child);
    const force = setTimeout(
      () => terminateChild(child, "SIGKILL").catch(() => {}),
      options.killTimeout || 2000,
    );
    force.unref?.();
    try {
      await exited;
    } finally {
      clearTimeout(force);
    }
  }
  async function flush() {
    if (running || closed) return;
    running = true;
    try {
      await stop();
      if (!closed) {
        const changes = [...pending];
        pending.clear();
        dirty = false;
        launch(changes);
      }
    } finally {
      running = false;
      if (dirty && !closed) schedule();
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(
      () => flush().catch((error) => controller.emit("childError", error)),
      restartDelay,
    );
  }
  controller.restart = (filename) => {
    if (closed) return;
    if (filename) pending.add(filename);
    dirty = true;
    if (!running) schedule();
  };
  launch();
  controller.watcher = (options.watch || chokidar.watch)(
    [
      cwd,
      ...(options.watchPaths || []).map((value) => path.resolve(cwd, value)),
    ],
    {
      ignored: (filename) =>
        !isWatchedFile(filename, {
          cwd,
          ignore,
          watchPaths: options.watchPaths,
        }),
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    },
  );
  // Let the initial directory scan settle before closing. Removing a project
  // during that scan can otherwise leave newly registered native watchers open.
  controller.ready = options.watch
    ? Promise.resolve(controller)
    : once(controller.watcher, "ready").then(() => controller);
  controller.ready.catch((error) => controller.emit("childError", error));
  controller.watcher.on("all", (event, filename) => {
    if (
      ["add", "change", "unlink"].includes(event) &&
      isWatchedFile(filename, {
        cwd,
        ignore,
        extensions,
        watchPaths: options.watchPaths,
      })
    )
      controller.restart(filename);
  });
  controller.close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    await controller.ready.catch(() => {});
    await controller.watcher.close();
    await stop();
  };
  return controller;
}
export function runOnChange(
  command,
  args = [],
  ignore = ["dist", ".temp"],
  extensions = [],
  options = {},
) {
  const cwd = options.cwd || process.cwd();
  const watcher = (options.watch || chokidar.watch)(
    [
      cwd,
      ...(options.watchPaths || []).map((value) => path.resolve(cwd, value)),
    ],
    {
      ignoreInitial: true,
      ignored: (filename) =>
        !isWatchedFile(filename, {
          cwd,
          ignore,
          watchPaths: options.watchPaths,
        }),
    },
  );
  let child,
    timer,
    pending = false,
    closed = false;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, options.delay ?? 50);
  }
  function run() {
    if (closed || child) return;
    pending = false;
    child = (options.spawn || spawn)(
      command,
      args === process.argv ? args.slice(2) : args,
      {
        cwd,
        env: options.env || process.env,
        stdio: "inherit",
        detached: process.platform !== "win32",
        windowsHide: true,
      },
    );
    const current = child;
    const finish = (error) => {
      if (child !== current) return;
      child = undefined;
      if (error) options.onError?.(error);
      if (pending && !closed) schedule();
    };
    current.once("exit", () => finish());
    current.once("error", finish);
  }
  watcher.on("all", (event, filename) => {
    if (
      !["add", "change", "unlink"].includes(event) ||
      !isWatchedFile(filename, {
        cwd,
        ignore,
        extensions,
        watchPaths: options.watchPaths,
      })
    )
      return;
    pending = true;
    if (!child) schedule();
  });
  const close = watcher.close.bind(watcher);
  watcher.close = async () => {
    closed = true;
    clearTimeout(timer);
    await close();
    if (child && child.exitCode == null && !child.signalCode) {
      const current = child;
      const exited = once(current, "exit").catch(() => {});
      const force = setTimeout(
        () => terminateChild(current, "SIGKILL").catch(() => {}),
        options.killTimeout || 2000,
      );
      force.unref?.();
      await terminateChild(current);
      try {
        await exited;
      } finally {
        clearTimeout(force);
      }
    }
  };
  return watcher;
}
