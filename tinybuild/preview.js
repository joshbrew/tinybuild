import path from "node:path";
import { serverRoot } from "./server-tools.js";
import { buildPlan } from "./esbuild/bundler.js";
import { defaultServer } from "./node_server/server.js";
import { mergeConfig } from "./config.js";
import { resolveNativeConfig } from "./native-config.js";
import { mobileDevelopment, mobileRunOptions } from "./mobile.js";
import { validateConfig } from "./config-options.js";
import { taskOrder } from "./tasks.js";
import {
  desktopDevelopment,
  electronLaunchOptions,
  tauriCommand,
} from "./desktop.js";

function serializable(value, key = "", ancestors = new Set()) {
  if (
    /env|password|secret|token|passphrase|credential|api[_-]?key|access[_-]?key|authorization/i.test(
      key,
    )
  )
    return value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).map((key) => [key, "[redacted]"]))
      : "[redacted]";
  if (typeof value === "function")
    return "[function " + (value.name || "anonymous") + "]";
  if (value instanceof RegExp) return value.toString();
  if (!value || typeof value !== "object")
    return typeof value === "bigint" ? String(value) : value;
  if (ancestors.has(value)) return "[circular]";
  const next = new Set(ancestors).add(value);
  return Array.isArray(value)
    ? value.map((item) => serializable(item, "", next))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          serializable(item, key, next),
        ]),
      );
}
export function previewConfig(
  input = {},
  { cwd = process.cwd(), strict, sources = {} } = {},
) {
  cwd = path.resolve(cwd);
  const expanded = resolveNativeConfig(mergeConfig({}, input));
  const config = expanded.serve
    ? {
        ...expanded,
        bundler: false,
        electron: false,
        tauri: false,
        mobile: false,
      }
    : desktopDevelopment(mobileDevelopment(expanded));
  const validation = validateConfig(config, {
    strict: strict ?? config.strictConfig,
  });
  const server =
    config.server === false || config.build
      ? false
      : {
          ...defaultServer,
          ...config.server,
          production: config.production ?? config.server?.production,
          root: serverRoot(
            {
              ...config.server,
              production: config.production ?? config.server?.production,
            },
            cwd,
          ),
        };
  const groups =
    config.bundler === false || config.serve
      ? []
      : buildPlan(
          (Array.isArray(config.bundler)
            ? config.bundler
            : [config.bundler || {}]
          ).map((value) => ({
            ...value,
            absWorkingDir: value.absWorkingDir || cwd,
          })),
        );
  const outputs = groups.flatMap((group) =>
    group.targets.map(({ target, options }) => ({
      target,
      entries: options.entryPoints,
      format: options.format,
      platform: options.platform,
      outfile:
        options.outfile && path.resolve(options.absWorkingDir, options.outfile),
      outdir:
        options.outdir && path.resolve(options.absWorkingDir, options.outdir),
      plugins: options.plugins.map((plugin) => plugin.name),
      gzip: group.config.bundleGzip === true,
    })),
  );
  const native = [];
  if (config.electron) {
    const options = typeof config.electron === "object" ? config.electron : {};
    const action = options.action || "open";
    const directory = path.resolve(
      cwd,
      typeof config.electron === "string"
        ? config.electron
        : options.directory || "electron",
    );
    native.push({
      target: "electron",
      action,
      directory,
      commands:
        action === "stage"
          ? []
          : action === "make"
            ? [["electron-forge", "make"]]
            : action === "package"
              ? [
                  [
                    "electron-packager",
                    directory,
                    options.name || config.native?.name || path.basename(cwd),
                    "--out",
                    options.outdir || "release",
                    "--overwrite",
                  ],
                ]
              : [
                  [
                    "electron",
                    ...electronLaunchOptions(options).flags,
                    directory,
                    ...electronLaunchOptions(options).args,
                  ],
                ],
    });
  }
  if (config.tauri) {
    const action = config.tauri.action || "build";
    native.push({
      target: "tauri",
      action,
      directory: path.join(cwd, "src-tauri"),
      commands:
        action === "stage"
          ? []
          : [
              tauriCommand(
                typeof config.tauri === "object" ? config.tauri : {},
                path.join(cwd, ".tinybuild/native-tauri.json"),
              ),
            ],
    });
  }
  for (const [platform, value] of Object.entries(config.mobile || {})) {
    if (!value) continue;
    const settings = typeof value === "object" ? value : {};
    const action = settings.action || (value === true ? "run" : value);
    const commands =
      action === "stage"
        ? []
        : [["cap", "add", platform, "[if platform missing]"]];
    if (!["stage", "add", "run"].includes(action))
      commands.push(["cap", "sync", platform]);
    if (!["stage", "add", "sync"].includes(action))
      commands.push([
        "cap",
        action,
        platform,
        ...(settings.target ? ["--target", settings.target] : []),
        ...(settings.liveReload
          ? server?.port === 0
            ? ["[live-reload flags use the listening port]"]
            : mobileRunOptions(
                platform,
                settings,
                (server?.protocol || "http") +
                  "://localhost:" +
                  (server?.port || 8080),
              )
          : []),
      ]);
    native.push({
      target: platform,
      action,
      directory: path.join(cwd, platform),
      commands,
    });
  }
  let order = [];
  try {
    order = taskOrder(config.tasks);
  } catch (error) {
    validation.errors.push({ path: "tasks", message: error.message });
  }
  return {
    cwd,
    profile: config.native?.profile,
    config: serializable(config),
    server: serializable(server),
    outputs,
    watch:
      config.build ||
      config.serve ||
      config.production ||
      server?.production ||
      !server?.hotreload
        ? []
        : [
            cwd,
            ...(config.server?.watch || []).map((file) =>
              path.resolve(cwd, file),
            ),
            ...(config.copy || []).map((item) => path.resolve(cwd, item.from)),
          ],
    copy: serializable(config.copy || []),
    tasks: order,
    native,
    validation,
    explanations: [
      {
        path: "server.root",
        source: input.server?.root
          ? sources["server.root"] || "config"
          : input.server?.staticRoots?.["/"]
            ? "server.staticRoots"
            : "default",
        reason: server
          ? "Serving " +
            server.root +
            (input.server?.root || input.server?.staticRoots?.["/"]
              ? " from the configured static folder."
              : server.production
                ? " because production uses dist by default."
                : " because development serves the project folder by default.")
          : "No HTTP server is started for this plan.",
      },
      {
        path: "server.hotreload",
        source:
          config.production || server?.production
            ? "production mode"
            : config.build || config.serve
              ? "command mode"
              : sources["server.hotreload"] ||
                (input.server?.hotreload === undefined ? "default" : "config"),
        reason:
          config.build ||
          config.serve ||
          config.production ||
          server?.production
            ? "File watching is disabled in this mode."
            : "Watching follows the server's hotreload setting.",
      },
      ...["production", "bundler", "server", "native.profile"]
        .filter((key) => sources[key])
        .map((key) => ({
          path: key,
          source: sources[key],
          reason: "Selected by " + sources[key] + ".",
        })),
      ...Object.entries(sources)
        .filter(
          ([key]) =>
            ![
              "production",
              "bundler",
              "server",
              "native.profile",
              "server.root",
              "server.hotreload",
            ].includes(key),
        )
        .map(([key, source]) => ({
          path: key,
          source,
          reason: "Selected by " + source + ".",
        })),
    ],
    note: "Read-only plan: config modules execute as normal JavaScript; tinybuild does not build, install, launch or stage anything. Native add commands are conditional; plugin installs and SDK prerequisites are checked only when running.",
  };
}
