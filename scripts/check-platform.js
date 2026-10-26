import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCommand, runPackageCommand } from "../tinybuild/process.js";
import { inside } from "../tinybuild/outputs.js";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));
export const platformSuites = {
  core: ["run", "check"],
  browser: ["run", "test:browser"],
  "native-ui": ["run", "test:native:ui"],
  "native-build": ["run", "test:native"],
  tauri: ["run", "test:native", "--", "--tauri"],
};
const roots = new Set([
  "tinybuild",
  "scripts",
  "tests",
  "examples",
  "package.json",
  "package-lock.json",
  "tinybuild.js",
  "tinybuild.d.ts",
  "README.md",
  "catgnome.png",
  "img",
  "LICENSE",
]);
const skipped = new Set([
  "node_modules",
  "dist",
  "android",
  "ios",
  "electron",
  "src-tauri",
  "mobile_dist",
  "target",
  "out",
  ".tinybuild",
  ".git",
]);
export function platformFile(relative) {
  const parts = relative.split(/[\\/]/).filter(Boolean);
  if (/\.(?:pem|key|jks|p12|pfx|keystore)$/i.test(parts.at(-1) || ""))
    return false;
  return (
    !parts.length ||
    (roots.has(parts[0]) &&
      !parts.some(
        (part) =>
          (skipped.has(part) &&
            !(
              parts[0] === "tinybuild" &&
              parts[1] === "templates" &&
              ["src-tauri", "electron"].includes(part)
            )) ||
          /^\.test-|^\.env(?:\.|$)/.test(part),
      ))
  );
}
export async function mirrorGuestFile(original, working, event, filename) {
  original = path.resolve(original);
  working = path.resolve(working);
  const source = path.resolve(filename);
  const relative = path.relative(original, source);
  const destination = path.resolve(working, relative);
  if (
    !inside(original, source) ||
    source === original ||
    !inside(working, destination) ||
    destination === working ||
    !platformFile(path.join("examples", path.basename(original), relative))
  )
    return;
  if (["unlink", "unlinkDir"].includes(event))
    await fs.rm(destination, { recursive: event === "unlinkDir", force: true });
  else if (
    ["add", "change"].includes(event) &&
    (await fs.lstat(source)).isFile()
  ) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
}

export function platformOptions({
  suite = "core",
  example = "desktop_debug",
  port = 8080,
  distribution = "Ubuntu",
  host = "127.0.0.1",
} = {}) {
  if (!Object.hasOwn(platformSuites, suite) && suite !== "dev")
    throw new Error("Unknown platform suite");
  if (!/^[a-z0-9_-]+$/i.test(example))
    throw new Error("Example must be a folder name");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Port must be 0 to 65535");
  if (!/^[a-z0-9][a-z0-9_. -]*$/i.test(distribution))
    throw new Error("Invalid WSL distribution name");
  if (!["127.0.0.1", "0.0.0.0", "::1", "::"].includes(host))
    throw new Error("Host must be a loopback or wildcard address");
  return { suite, example, port, distribution, host };
}

export async function runGuest({ source, install = false, desktop, ...input }) {
  const options = platformOptions(input);
  source = path.resolve(source);
  const key = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const project = path.join(os.tmpdir(), "tinybuild-platform-" + key);
  if (
    path.dirname(project) !== path.resolve(os.tmpdir()) ||
    !path.basename(project).startsWith("tinybuild-platform-")
  )
    throw new Error("Unsafe guest project path");
  await fs.mkdir(project, { recursive: true });
  for (const directory of ["tinybuild", "scripts", "tests", "examples"]) {
    const target = path.join(project, directory);
    if (!inside(project, target) || target === project)
      throw new Error("Unsafe guest refresh path");
    await fs.rm(target, { recursive: true, force: true });
  }
  await fs.cp(source, project, {
    recursive: true,
    filter: async (filename) =>
      platformFile(path.relative(source, filename)) &&
      !(await fs.lstat(filename)).isSymbolicLink(),
  });
  const env = {
    ...process.env,
    PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
  };
  delete env.npm_execpath;
  const cancellation = new AbortController();
  const stop = () => cancellation.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let watcher;
  try {
    if (install)
      await runPackageCommand(["ci", "--no-audit", "--no-fund"], {
        cwd: project,
        env,
        signal: cancellation.signal,
      });
    else
      await fs
        .access(path.join(project, "node_modules/esbuild/package.json"))
        .catch(() => {
          throw new Error(
            "Guest dependencies are missing; add --install for the first run",
          );
        });
    console.log(
      "Guest: " +
        process.platform +
        " " +
        process.arch +
        " Node " +
        process.version +
        "; isolated project: " +
        project,
    );
    if (options.suite === "native-ui" && install)
      await runPackageCommand(
        [
          "install",
          "--prefix",
          path.join(project, ".test-native/runtime"),
          "electron@44.8.0",
          "--no-audit",
          "--no-fund",
        ],
        { cwd: project, env, signal: cancellation.signal },
      );
    if (options.suite === "browser" && install)
      await runCommand(
        process.execPath,
        [
          path.join(project, "node_modules/playwright-core/cli.js"),
          "install",
          "chromium",
        ],
        { cwd: project, env, signal: cancellation.signal },
      );
    if (options.suite === "dev") {
      if (desktop && !["electron", "tauri"].includes(desktop))
        throw new Error("Desktop must be electron or tauri");
      const require = createRequire(path.join(project, "package.json"));
      const { default: chokidar } = await import(
        pathToFileURL(require.resolve("chokidar")).href
      );
      const original = path.join(source, "examples", options.example);
      const working = path.join(project, "examples", options.example);
      await fs.access(path.join(working, "tinybuild.config.js"));
      watcher = chokidar.watch(original, {
        ignoreInitial: true,
        usePolling: true,
        interval: 200,
        followSymlinks: false,
        ignored: (filename) => !platformFile(path.relative(source, filename)),
      });
      let sync = Promise.resolve();
      watcher.on("all", (event, filename) => {
        sync = sync
          .then(() => mirrorGuestFile(original, working, event, filename))
          .catch((error) => console.error("Guest sync: " + error.message));
      });
      console.log(
        "Edit the host example normally; saved files are mirrored into the guest. Open http://localhost:" +
          options.port +
          " on the host.",
      );
      await runCommand(
        process.execPath,
        [
          path.join(project, "tinybuild/bin/global.js"),
          "--host",
          options.host,
          "--port",
          String(options.port),
          ...(desktop ? ["desktop=" + desktop, "--devtools"] : []),
        ],
        { cwd: working, env, signal: cancellation.signal },
      );
      await sync;
    } else
      await runPackageCommand(platformSuites[options.suite], {
        cwd: project,
        env,
        signal: cancellation.signal,
      });
  } finally {
    await watcher?.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
  return { project, platform: process.platform, suite: options.suite };
}

export async function runWsl(input = {}) {
  const options = platformOptions(input);
  const { stdout } = await execute(
    "wsl.exe",
    [
      "--distribution",
      options.distribution,
      "--exec",
      "wslpath",
      "-a",
      repository,
    ],
    { windowsHide: true },
  );
  const source = stdout.trim();
  const node = input.node || source + "/.test-platform/tools/node/bin/node";
  if (!source.startsWith("/") || !node.startsWith("/"))
    throw new Error("Pass an absolute Linux Node path with --node");
  const args = [
    "--distribution",
    options.distribution,
    "--exec",
    node,
    source + "/scripts/check-platform.js",
    "--guest",
    "--source",
    source,
    "--suite",
    options.suite,
    "--example",
    options.example,
    "--port",
    String(options.port),
    "--host",
    options.host,
    ...(input.install ? ["--install"] : []),
    ...(input.desktop ? ["--desktop", input.desktop] : []),
  ];
  await runCommand("wsl.exe", args);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const value = (name) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const options = {
    suite: value("--suite"),
    example: value("--example"),
    port: value("--port") === undefined ? undefined : Number(value("--port")),
    distribution: value("--wsl"),
    node: value("--node"),
    install: args.includes("--install"),
    desktop: value("--desktop"),
    host: value("--host"),
  };
  if (args.includes("--guest"))
    console.log(
      JSON.stringify(await runGuest({ ...options, source: value("--source") })),
    );
  else if (value("--wsl")) await runWsl(options);
  else
    throw new Error(
      "Choose --wsl Ubuntu. Use --suite core, browser, native-ui, native-build, tauri or dev; add --install for guest dependencies.",
    );
}
