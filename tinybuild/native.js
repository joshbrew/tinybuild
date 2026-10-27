import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import create from "./create.js";
import { getTemplateSync } from "./node_server/get.js";
import { runPackageCommand, packageAvailable, runCommand } from "./process.js";
import { createRequire } from "node:module";
import { startTasks } from "./tasks.js";
import { mobileDevelopment, mobileRunOptions } from "./mobile.js";
import { serverRoot } from "./server-tools.js";
import {
  desktopDevelopment,
  electronLaunchOptions,
  tauriCommand,
} from "./desktop.js";
import {
  resolveNativeConfig,
  prepareNativeConfig,
  applyNativePermissions,
  applyNativeMetadata,
} from "./native-config.js";

function contained(root, filename) {
  const relative = path.relative(root, filename);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative))
  );
}
export function outputDirectory(bundler = {}, cwd = process.cwd()) {
  if (Array.isArray(bundler)) bundler = bundler[0];
  if (bundler.outdir) return path.resolve(cwd, bundler.outdir);
  if (bundler.outfile) return path.dirname(path.resolve(cwd, bundler.outfile));
  throw new Error("An outfile or outdir is required for native staging");
}
async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) =>
        entry.isDirectory()
          ? walk(path.join(directory, entry.name))
          : entry.isFile()
            ? [path.join(directory, entry.name)]
            : [],
      ),
    )
  ).flat();
}
export async function stageWeb(
  config,
  results = [],
  destination,
  { cwd = process.cwd() } = {},
) {
  const directory = path.resolve(cwd, destination);
  const generatedHTML = results
    .flatMap((group) => Object.values(group))
    .find((result) => result?.html)?.html;
  const html = generatedHTML
    ? path.resolve(cwd, generatedHTML)
    : path.resolve(
        serverRoot(
          {
            ...config.server,
            production:
              config.server === false
                ? false
                : (config.production ?? config.server?.production),
          },
          cwd,
        ),
        config.server?.startpage || "index.html",
      );
  await fs.access(html);
  const base = path.dirname(html);
  const files = new Set([html]);
  const extraAssets = new Set();
  const assetRoots = new Map();
  if (config.server?.pwa) {
    const root = serverRoot(
      {
        ...config.server,
        production: config.production ?? config.server.production,
      },
      cwd,
    );
    const file = path.resolve(root, config.server.pwa);
    files.add(file);
    extraAssets.add(file);
    assetRoots.set(file, root);
  }
  for (const group of results)
    for (const result of Object.values(group))
      if (result?.metafile)
        for (const filename of Object.keys(result.metafile.outputs))
          files.add(path.resolve(group.config.absWorkingDir || cwd, filename));
  if (!results.length)
    for (const filename of await walk(outputDirectory(config.bundler, cwd)))
      files.add(filename);
  for (const asset of config.assets || []) {
    const filename = path.resolve(cwd, asset);
    const stat = await fs.stat(filename);
    for (const item of stat.isDirectory() ? await walk(filename) : [filename]) {
      files.add(item);
      extraAssets.add(item);
    }
  }
  const plan = [];
  for (const filename of files) {
    const assetBase =
      generatedHTML && extraAssets.has(filename) && !contained(base, filename)
        ? assetRoots.get(filename) || path.resolve(cwd)
        : base;
    if (!contained(assetBase, filename))
      throw new Error(
        "Staged asset must be inside the HTML directory: " + filename,
      );
    if (
      /\.(jks|pem|key|pfx|p12|keystore)(?:\.gz)?$/i.test(filename) ||
      /\.env(?:\.|$)/i.test(path.basename(filename)) ||
      path
        .relative(assetBase, filename)
        .split(path.sep)
        .some((part) => part.startsWith("."))
    )
      throw new Error("Private file cannot be staged: " + filename);
    const relative = path.relative(assetBase, filename);
    if (!contained(directory, path.resolve(directory, relative)))
      throw new Error("Invalid staging destination");
    if (path.resolve(directory, relative) === filename)
      throw new Error("Staging destination must differ from source");
    plan.push({ filename, relative });
  }
  if (path.basename(html) !== "index.html")
    plan.push({ filename: html, relative: "index.html" });
  const destinations = new Map();
  for (const item of plan) {
    const target = path.resolve(directory, item.relative);
    const key = process.platform === "win32" ? target.toLowerCase() : target;
    if (destinations.has(key) && destinations.get(key) !== item.filename)
      throw new Error(
        "Two staged files map to " +
          item.relative +
          "; rename the extra asset or change the output path",
      );
    destinations.set(key, item.filename);
  }
  await fs.mkdir(directory, { recursive: true });
  const manifestFile = path.join(directory, ".tinybuild-manifest.json");
  let previous = [];
  try {
    previous = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const relative of previous) {
    const filename = path.resolve(directory, relative);
    if (!contained(directory, filename))
      throw new Error("Invalid staging manifest");
    if (!plan.some((item) => item.relative === relative))
      await fs.unlink(filename).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
  for (const { filename, relative } of plan) {
    const target = path.join(directory, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(filename, target);
  }
  await fs.writeFile(
    manifestFile,
    JSON.stringify(
      plan.map((item) => item.relative),
      null,
      2,
    ),
  );
  return {
    directory,
    html: path.join(directory, "index.html"),
    files: plan.map((item) => item.relative),
  };
}
export async function packageNative(
  config,
  results,
  {
    cwd = process.cwd(),
    run = runPackageCommand,
    dryRun = false,
    devUrl,
    sign = runCommand,
    signal,
    supervise = startTasks,
  } = {},
) {
  config = desktopDevelopment(mobileDevelopment(resolveNativeConfig(config)));
  if (
    config.electron?.action &&
    !["stage", "open", "package", "make"].includes(config.electron.action)
  )
    throw new Error("Unknown Electron action: " + config.electron.action);
  if (
    config.tauri?.action &&
    !["stage", "dev", "build"].includes(config.tauri.action)
  )
    throw new Error("Unknown Tauri action: " + config.tauri.action);
  for (const value of Object.values(config.mobile || {})) {
    if (!value) continue;
    const action =
      typeof value === "object" ? value.action : value === true ? "run" : value;
    if (!["stage", "add", "sync", "open", "run", "build"].includes(action))
      throw new Error("Unknown mobile action: " + action);
    if (value.target && action !== "run")
      throw new Error("Mobile device target is supported by the run action");
    if (value.flavor && !["run", "build"].includes(action))
      throw new Error("Mobile flavor is supported by run/build actions");
  }
  const native = config.native || {};
  const electron = typeof config.electron === "object" ? config.electron : {};
  const electronLaunch = electronLaunchOptions(electron);
  if (electron.watch && (config.production || config.build))
    throw new Error("Electron watch requires development mode");
  if (config.tauri && config.tauri.action !== "stage")
    tauriCommand(typeof config.tauri === "object" ? config.tauri : {});
  const prepared = await prepareNativeConfig(config, cwd, { devUrl });
  const environment = {
    ...process.env,
    ...native.env,
  };
  delete environment.TINYBUILD_DEV_URL;
  if (
    config.electron &&
    (electron.action || "open") === "open" &&
    electron.liveReload !== false
  ) {
    const url = prepared?.devUrl || devUrl;
    if (url) environment.TINYBUILD_DEV_URL = url;
    else if (electron.liveReload)
      throw new Error(
        "Electron liveReload needs a listening development server",
      );
  }
  const releases =
    ["package", "make"].includes(config.electron?.action) ||
    (config.tauri && (config.tauri.action || "build") === "build") ||
    Object.values(config.mobile || {}).some(
      (value) => value === "build" || value?.action === "build",
    );
  if (releases && !dryRun)
    for (const name of native.signing?.requiredEnv || [])
      if (!environment[name])
        throw new Error("Missing signing environment variable: " + name);
  const tasks = [];
  const artifactDirectories = [];
  const invocations = [];
  const supervisors = [];
  const watched = {};
  async function command(args, commandCwd = cwd) {
    tasks.push(args);
    invocations.push({ args, cwd: commandCwd });
    if (!dryRun)
      await run(args, {
        cwd: commandCwd,
        manager: "npx",
        env: environment,
        signal,
      });
  }
  async function dependency(name, version, directory = cwd, dev = true) {
    if (dryRun) return;
    if (directory === cwd && packageAvailable(name, cwd)) return;
    if (directory !== cwd) {
      try {
        await fs.access(
          path.join(directory, "node_modules", name, "package.json"),
        );
        return;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (config.production || config.frozen)
      throw new Error("Native dependency missing in frozen mode: " + name);
    await run(["install", dev ? "-D" : "--save", name + "@" + version], {
      cwd: directory,
      manager: "npm",
      env: environment,
      signal,
    });
  }
  const active = Boolean(
    (config.electron && config.electron.action !== "stage") ||
    (config.tauri && config.tauri.action !== "stage") ||
    Object.values(config.mobile || {}).some(
      (value) => value && value !== "stage" && value.action !== "stage",
    ),
  );
  if (
    prepared?.manualConfig.length &&
    Object.values(config.mobile || {}).some(
      (value) => value && value !== "stage" && value.action !== "stage",
    )
  )
    throw new Error(
      "Merge .tinybuild/native-capacitor.json into your existing Capacitor config before running native macros: " +
        prepared.manualConfig[0],
    );
  if (active)
    for (const plugin of native.plugins || []) {
      const target = plugin.target || "mobile";
      const targetActive =
        target === "mobile"
          ? Object.values(config.mobile || {}).some(
              (value) => value && value !== "stage" && value.action !== "stage",
            )
          : Boolean(config[target] && config[target].action !== "stage");
      if (!targetActive) continue;
      if (plugin.target === "tauri") {
        if (!/^[a-z][a-z0-9-]*$/.test(plugin.name))
          throw new Error("Invalid Tauri plugin name");
        const cargo = await fs
          .readFile(path.join(cwd, "src-tauri/Cargo.toml"), "utf8")
          .catch((error) => {
            if (error.code === "ENOENT") return "";
            throw error;
          });
        if (
          !new RegExp("^tauri-plugin-" + plugin.name + "\\s*=", "m").test(
            cargo,
          ) ||
          !packageAvailable("@tauri-apps/plugin-" + plugin.name, cwd)
        ) {
          if (config.production || config.frozen)
            throw new Error(
              "Tauri plugin missing in frozen mode: " + plugin.name,
            );
          create.tauriapp(cwd);
          await dependency("@tauri-apps/cli", "^2.0.0");
          await command(["tauri", "add", plugin.name]);
        }
      } else if (target === "electron") {
        const shell = path.resolve(
          cwd,
          typeof config.electron === "string"
            ? config.electron
            : config.electron.directory || "electron",
        );
        create.electronapp(shell);
        const pkgFile = path.join(shell, "package.json");
        const pkg = JSON.parse(await fs.readFile(pkgFile, "utf8"));
        pkg.dependencies = {
          ...pkg.dependencies,
          [plugin.name]: plugin.version || "latest",
        };
        await fs.writeFile(pkgFile, JSON.stringify(pkg, null, 2));
        await dependency(plugin.name, plugin.version || "latest", shell, false);
      } else await dependency(plugin.name, plugin.version || "latest");
    }
  const stages = {};
  try {
    if (config.electron) {
      const options =
        typeof config.electron === "object" ? config.electron : {};
      const shell = path.resolve(
        cwd,
        typeof config.electron === "string"
          ? config.electron
          : options.directory || "electron",
      );
      create.electronapp(shell);
      {
        const file = path.join(shell, "package.json");
        const pkg = JSON.parse(await fs.readFile(file, "utf8"));
        await fs.writeFile(
          file,
          JSON.stringify(
            {
              ...pkg,
              ...(native.name ? { productName: native.name } : {}),
              ...(native.author ? { author: native.author } : {}),
              ...(native.description
                ? { description: native.description }
                : {}),
              ...(native.license ? { license: native.license } : {}),
              ...(native.version ? { version: native.version } : {}),
            },
            null,
            2,
          ),
        );
        await fs.writeFile(
          path.join(shell, "tinybuild-app.json"),
          JSON.stringify(
            {
              id: native.id,
              name: native.name,
              icon: native.icons?.electron
                ? "app-icon" + path.extname(native.icons.electron)
                : undefined,
              window: electronLaunch.window,
              devtools: electronLaunch.devtools,
            },
            null,
            2,
          ),
        );
      }
      if (native.icons?.electron)
        await fs.copyFile(
          path.resolve(cwd, native.icons.electron),
          path.join(shell, "app-icon" + path.extname(native.icons.electron)),
        );
      stages.electron = await stageWeb(
        config,
        results,
        path.join(shell, "web"),
        {
          cwd,
        },
      );
      if (options.action !== "stage" && options.action !== "make")
        await dependency("electron", "^44.8.0");
      if (options.action === "make") {
        artifactDirectories.push(path.join(shell, "out/make"));
        const pkgFile = path.join(shell, "package.json");
        const pkg = JSON.parse(await fs.readFile(pkgFile, "utf8"));
        const makers = options.makers || [
          { name: "@electron-forge/maker-zip" },
        ];
        pkg.devDependencies = {
          ...pkg.devDependencies,
          electron:
            pkg.devDependencies?.electron &&
            pkg.devDependencies.electron !== "*"
              ? pkg.devDependencies.electron
              : "^44.8.0",
          "@electron-forge/cli": "^8.0.1",
        };
        for (const maker of makers) {
          if (
            !maker.name ||
            (!maker.version && !maker.name.startsWith("@electron-forge/maker-"))
          )
            throw new Error(
              "Third-party Electron makers require an explicit version",
            );
          pkg.devDependencies[maker.name] = maker.version || "^8.0.1";
        }
        if (!pkg.config?.forge || options.forge || options.makers) {
          const forge = {
            packagerConfig: {
              asar: true,
              ...(native.id ? { appBundleId: native.id } : {}),
              ...(native.icons?.electron
                ? { icon: path.resolve(cwd, native.icons.electron) }
                : {}),
            },
            makers: makers.map(({ version, ...maker }) => maker),
            ...options.forge,
          };
          await fs.writeFile(
            path.join(shell, "tinybuild-forge.cjs"),
            "module.exports=" + JSON.stringify(forge, null, 2) + ";\n",
          );
          pkg.config = { ...pkg.config, forge: "./tinybuild-forge.cjs" };
        }
        await fs.writeFile(pkgFile, JSON.stringify(pkg, null, 2));
        if (!dryRun) {
          const installed = await Promise.all(
            Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).map(
              async (name) => {
                try {
                  await fs.access(
                    path.join(shell, "node_modules", name, "package.json"),
                  );
                  return true;
                } catch (error) {
                  if (error.code === "ENOENT") return false;
                  throw error;
                }
              },
            ),
          );
          if (installed.includes(false)) {
            if (config.production || config.frozen)
              throw new Error(
                "Electron make requires installed shell dependencies in frozen mode",
              );
            await run(["install"], {
              cwd: shell,
              manager: "npm",
              env: environment,
              signal,
            });
          }
        }
        await command(
          [
            "electron-forge",
            "make",
            ...(options.platform ? ["--platform", options.platform] : []),
            ...(options.arch ? ["--arch", options.arch] : []),
          ],
          shell,
        );
      } else if (options.action === "package") {
        artifactDirectories.push(
          path.resolve(cwd, options.outdir || "release"),
        );
        await dependency("@electron/packager", "^20.3.0");
        // An installed/inherited runtime may have no dependency entry in this
        // project's package.json. Packager still needs its exact version.
        let electronVersion;
        try {
          const filename = createRequire(
            path.join(cwd, "package.json"),
          ).resolve("electron/package.json");
          electronVersion = JSON.parse(
            await fs.readFile(filename, "utf8"),
          ).version;
        } catch (error) {
          if (error.code !== "MODULE_NOT_FOUND") throw error;
        }
        await command([
          "electron-packager",
          shell,
          options.name || native.name || path.basename(cwd),
          "--out",
          options.outdir || "release",
          "--overwrite",
          ...(electronVersion ? ["--electron-version", electronVersion] : []),
          ...(native.id ? ["--app-bundle-id", native.id] : []),
          ...(native.version ? ["--app-version", native.version] : []),
          ...(native.icons?.electron
            ? ["--icon", path.resolve(cwd, native.icons.electron)]
            : []),
          ...(options.platform ? ["--platform", options.platform] : []),
          ...(options.arch ? ["--arch", options.arch] : []),
        ]);
      } else if (options.action !== "stage") {
        const args = [
          "electron",
          ...electronLaunch.flags,
          shell,
          ...electronLaunch.args,
        ];
        if (options.watch) {
          const pkg = JSON.parse(
            await fs.readFile(path.join(shell, "package.json"), "utf8"),
          );
          const paths = Array.isArray(options.watch)
            ? options.watch.map((file) => path.resolve(shell, file))
            : [
                path.resolve(shell, pkg.main || "electron_app.js"),
                path.join(shell, "electron_preload.js"),
              ];
          watched.electron = paths;
          tasks.push(args);
          invocations.push({ args, cwd });
          if (!dryRun) {
            const executable = createRequire(path.join(cwd, "package.json"))(
              "electron",
            );
            supervisors.push(
              await supervise(
                {
                  electron: {
                    command: executable,
                    args: args.slice(1),
                    cwd,
                    env: environment,
                    watch: paths,
                    delay: options.restartDelay ?? 150,
                  },
                },
                { cwd, signal },
              ),
            );
          }
        } else await command(args);
      }
    }
    if (config.tauri) {
      const options = typeof config.tauri === "object" ? config.tauri : {};
      if ((options.action || "build") === "build")
        artifactDirectories.push(
          path.join(
            path.resolve(
              cwd,
              environment.CARGO_TARGET_DIR || "src-tauri/target",
            ),
            ...(options.target ? [options.target] : []),
            options.debug ? "debug" : "release",
            ...(options.noBundle ? [] : ["bundle"]),
          ),
        );
      create.tauriapp(cwd);
      const cargo = await fs.readFile(
        path.join(cwd, "src-tauri/Cargo.toml"),
        "utf8",
      );
      if (!/version\s*=\s*"2(?:\.|")/.test(cargo))
        throw new Error(
          "Existing Tauri project uses an older template; migrate it before using the v2 adapter",
        );
      stages.tauri = await stageWeb(config, results, "src-tauri/tauri_dist", {
        cwd,
      });
      if (options.action !== "stage")
        await dependency("@tauri-apps/cli", "^2.0.0");
      if (options.action !== "stage")
        await command(tauriCommand(options, prepared?.tauriFile));
    }
    if (config.mobile) {
      create.capacitor(cwd);
      stages.mobile = await stageWeb(config, results, "mobile_dist", { cwd });
      if (
        Object.values(config.mobile).some(
          (action) => action && action !== "stage" && action.action !== "stage",
        )
      )
        for (const name of ["@capacitor/core", "@capacitor/cli"])
          await dependency(name, "^8.5.3");
      for (const platform of ["android", "ios"]) {
        const value = config.mobile[platform];
        if (!value) continue;
        const settings = typeof value === "object" ? value : {};
        const action = settings.action || (value === true ? "run" : value);
        if (action === "stage") continue;
        if (!["add", "sync", "open", "run", "build"].includes(action))
          throw new Error("Unknown mobile action: " + action);
        await dependency("@capacitor/" + platform, "^8.5.3");
        try {
          await fs.access(path.join(cwd, platform));
        } catch {
          await command(["cap", "add", platform]);
        }
        await applyNativePermissions(native, cwd);
        await applyNativeMetadata(native, cwd);
        if (native.icons?.mobile) {
          await dependency("@capacitor/assets", "^3.0.5");
          await command([
            "capacitor-assets",
            "generate",
            "--assetPath",
            path.resolve(cwd, native.icons.mobile),
            "--" + platform,
          ]);
        }
        if (action !== "add") {
          // cap run performs its own sync after applying live-reload overrides.
          if (action !== "run") await command(["cap", "sync", platform]);
          if (action !== "sync")
            await command([
              "cap",
              action,
              platform,
              ...(settings.target ? ["--target", settings.target] : []),
              ...(settings.flavor ? ["--flavor", settings.flavor] : []),
              ...(settings.scheme ? ["--scheme", settings.scheme] : []),
              ...(settings.configuration
                ? ["--configuration", settings.configuration]
                : []),
              ...mobileRunOptions(platform, settings, devUrl),
            ]);
        }
      }
    }
    await applyNativePermissions(native, cwd);
    await applyNativeMetadata(native, cwd);
    for (const hook of releases
      ? [native.signing?.command, native.signing?.verify].filter(Boolean)
      : []) {
      if (
        !Array.isArray(hook) ||
        !hook.length ||
        hook.some((value) => typeof value !== "string")
      )
        throw new Error(
          "Signing and verification commands require a nonempty list of strings",
        );
      const [executable, ...args] = hook;
      if (!executable)
        throw new Error("Signing command requires an executable");
      tasks.push([executable, ...args]);
      if (!dryRun)
        await sign(executable, args, {
          cwd,
          env: {
            ...environment,
            TINYBUILD_ARTIFACT_DIRS: JSON.stringify(artifactDirectories),
          },
          signal,
        });
    }
    const artifacts = await Promise.all(
      artifactDirectories.map(async (directory) => {
        try {
          const entries = await fs.readdir(directory, { withFileTypes: true });
          return {
            directory,
            exists: true,
            entries: entries
              .filter((entry) => entry.isFile() || entry.isDirectory())
              .map((entry) => ({
                path: path.join(directory, entry.name),
                type: entry.isDirectory() ? "directory" : "file",
              }))
              .sort((a, b) => a.path.localeCompare(b.path)),
          };
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          return { directory, exists: false, entries: [] };
        }
      }),
    );
    return {
      stages,
      commands: tasks,
      invocations,
      config: prepared,
      artifactDirectories,
      artifacts,
      watched,
      close: async () => {
        await Promise.all(supervisors.map((supervisor) => supervisor.close()));
      },
    };
  } catch (error) {
    await Promise.allSettled(
      supervisors.map((supervisor) => supervisor.close()),
    );
    throw error;
  }
}

export async function generatePWA({
  cwd = process.cwd(),
  root = ".",
  filename = "service-worker.js",
  results = [],
} = {}) {
  const publicRoot = path.resolve(cwd, root);
  const files = results.flatMap((group) =>
    Object.values(group).flatMap((result) =>
      result?.metafile
        ? [
            ...Object.keys(result.metafile.outputs).map((file) =>
              path.resolve(group.config.absWorkingDir || cwd, file),
            ),
            ...(result.htmlFiles || (result.html ? [result.html] : [])),
          ]
        : [],
    ),
  );
  const assets = [
    ...new Set(
      files
        .filter((file) => !file.endsWith(".map") && contained(publicRoot, file))
        .map(
          (file) =>
            "/" + path.relative(publicRoot, file).split(path.sep).join("/"),
        ),
    ),
  ];
  const digest = createHash("sha256");
  for (const file of [...files].sort()) digest.update(await fs.readFile(file));
  const version = digest.digest("hex").slice(0, 16);
  const worker = getTemplateSync("pwa/service-worker.js")
    .toString()
    .replace("__TINYBUILD_ASSETS__", JSON.stringify(assets))
    .replace("__TINYBUILD_VERSION__", JSON.stringify(version));
  const output = path.resolve(cwd, filename);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, worker);
  return { filename: output, assets, version };
}
