import { electronLaunchOptions, tauriCommand } from "./desktop.js";
import { validateServerTools } from "./server-tools.js";
import { remotePlan } from "./remote.js";
import { validateChecks } from "./checks-config.js";
const names = (text) => text.split(/\s+/).filter(Boolean);
// Tinybuild-owned fields. Ordinary esbuild fields remain an upstream API.
export const configOptions = {
  root: names(
    "bundler server build serve production frozen stats native profile budgets diagnostics tasks assets copy strictConfig metadata electron tauri mobile remotes checks",
  ),
  bundler: names(
    "bundleBrowser bundleESM bundleNode bundleCommonJS bundleIIFE bundleTypes bundleHTML bundleGzip includeDefaultPlugins blobWorkers workerBundler workerType runtimeAssets autoInstall remoteImports outputs globalThis globals init modifyExtensions hotSwap hotswap hotReload input defaultConfig",
  ),
  server: names(
    "cwd root staticRoots host port portRetries open cacheControl isReady responseTimeout onRequest protocol keypath certpath passphrase startpage errpage hotreload reloadscripts routes headers watch ignore extensions production pwa delay readinessPath shutdownTimeout requestTimeout spa proxy python pythonUrl pythonRejectUnauthorized onError debug allowedOrigins redirect redirectStatus hotreloadTransport hotreloadExtensions python_node socket_protocol precompressed",
  ),
  native: names(
    "id name author description license version buildNumber profile profiles targets icons devUrl devHost env plugins presets permissions signing capacitor tauri",
  ),
  tasks: names("command args cwd env dependsOn mode ready timeout watch delay"),
  budgets: names(
    "totalBytes entryBytes gzipBytes brotliBytes growthBytes onExceed",
  ),
  diagnostics: names("compression baseline report"),
  electron: names(
    "action directory name outdir platform arch makers forge liveReload devtools inspect args window watch restartDelay",
  ),
  tauri: names(
    "action target bundles liveReload features debug noBundle watch",
  ),
};
export const cliOptions = names(
  "remote dev status url envFile start bundle init help doctor devices analyze benchmark lan qr path cfgpath config configure set yes GLOBAL changed mode dir entry core includeCore script device connection desktop devtools inspect preview validate strict clean dryRun baseline report json check stage options search example list agentGuide doctorTarget worker typescript workerRuntime",
);
export const esbuildOptions = names(
  "absWorkingDir absPaths alias allowOverwrite assetNames banner bundle charset chunkNames color conditions define drop dropLabels entryNames entryPoints external footer format globalName ignoreAnnotations inject jsx jsxDev jsxFactory jsxFragment jsxImportSource jsxSideEffects keepNames legalComments lineLimit loader logLevel logLimit logOverride logStyle mainFields mangleCache mangleProps mangleQuoted metafile minify minifyIdentifiers minifySyntax minifyWhitespace nodePaths outbase outdir outExtension outfile packages platform plugins preserveSymlinks publicPath pure reserveProps resolveExtensions sourceRoot sourcemap sourcesContent splitting stdin supported target treeShaking tsconfig tsconfigRaw write",
);

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = saved;
    }
  }
  return row[b.length];
}
export function validateConfig(
  config,
  { strict = config?.strictConfig === true } = {},
) {
  const errors = [],
    warnings = [];
  const issue = (path, message, error = true) =>
    (error ? errors : warnings).push({ path, message });
  const object = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
  const checkKeys = (value, keys, prefix) => {
    for (const key of Object.keys(value || {}))
      if (!keys.includes(key)) {
        const closest = keys
          .map((name) => [
            name,
            distance(key.toLowerCase(), name.toLowerCase()),
          ])
          .sort((a, b) => a[1] - b[1])[0];
        issue(
          prefix + key,
          "Unknown option" +
            (closest && closest[1] <= 3
              ? "; did you mean " + prefix + closest[0] + "?"
              : "; put application-specific values in metadata"),
          strict,
        );
      }
  };
  if (!object(config)) {
    issue("config", "Expected a configuration object");
    return { errors, warnings };
  }
  try {
    validateChecks(config.checks);
  } catch (error) {
    issue("checks", error.message);
  }
  checkKeys(config, [...configOptions.root, ...cliOptions], "");
  for (const name of [
    "build",
    "serve",
    "production",
    "frozen",
    "stats",
    "strictConfig",
  ])
    if (config[name] !== undefined && typeof config[name] !== "boolean")
      issue(name, "Expected true or false");
  if (config.build && config.serve)
    issue("build", "build and serve cannot both be enabled");
  if (config.bundler !== undefined && config.bundler !== false) {
    const groups = Array.isArray(config.bundler)
      ? config.bundler
      : [config.bundler];
    groups.forEach((value, index) => {
      const prefix = Array.isArray(config.bundler)
        ? "bundler[" + index + "]."
        : "bundler.";
      if (!object(value)) {
        issue(
          prefix.slice(0, -1),
          "Expected an esbuild options object or false",
        );
        return;
      }
      checkKeys(value, [...configOptions.bundler, ...esbuildOptions], prefix);
      if (value.outfile && value.outdir)
        issue(
          prefix + "outfile",
          "Choose outfile or outdir; outdir currently takes precedence",
          false,
        );
      if (value.workerType && !["module", "classic"].includes(value.workerType))
        issue(prefix + "workerType", "Use module or classic");
      if (value.bundleHTML && value.write === false)
        issue(prefix + "bundleHTML", "Portable HTML needs write:true");
      if (
        value.bundleGzip !== undefined &&
        typeof value.bundleGzip !== "boolean"
      )
        issue(prefix + "bundleGzip", "Expected true or false");
      if (value.bundleGzip && value.write === false)
        issue(prefix + "bundleGzip", "Gzip output needs write:true");
      if (value.splitting && value.format && value.format !== "esm")
        issue(prefix + "splitting", "Code splitting requires format:'esm'");
      for (const key of [
        "bundleBrowser",
        "bundleESM",
        "bundleNode",
        "bundleCommonJS",
        "bundleIIFE",
      ])
        if (
          value[key] !== undefined &&
          typeof value[key] !== "boolean" &&
          !object(value[key])
        )
          issue(
            prefix + key,
            "Expected a boolean or per-target esbuild options",
          );
    });
  }
  if (config.server !== undefined && config.server !== false) {
    if (!object(config.server))
      issue("server", "Expected a server object or false");
    else {
      const value = config.server;
      try {
        validateServerTools(value);
      } catch (error) {
        issue("server", error.message);
      }
      if (
        value.precompressed !== undefined &&
        typeof value.precompressed !== "boolean"
      )
        issue("server.precompressed", "Expected true or false");
      checkKeys(value, configOptions.server, "server.");
      if (
        value.port !== undefined &&
        (!Number.isInteger(value.port) || value.port < 0 || value.port > 65535)
      )
        issue(
          "server.port",
          "Expected an integer from 0 to 65535 (0 selects an available port)",
        );
      if (value.protocol && !["http", "https"].includes(value.protocol))
        issue("server.protocol", "Use http or https");
      if (
        value.socket_protocol !== undefined &&
        !["ws", "wss"].includes(value.socket_protocol)
      )
        issue("server.socket_protocol", "Use ws or wss");
      if (
        value.python_node !== undefined &&
        (!Number.isInteger(value.python_node) ||
          value.python_node < 0 ||
          value.python_node > 65535)
      )
        issue("server.python_node", "Expected a port from 0 to 65535");
      if (value.protocol === "https" && (!value.keypath || !value.certpath))
        issue("server.protocol", "HTTPS requires keypath and certpath");
      if (
        value.hotreloadTransport &&
        !["ws", "sse"].includes(value.hotreloadTransport)
      )
        issue("server.hotreloadTransport", "Use ws or sse");
      for (const key of ["watch", "ignore", "extensions", "allowedOrigins"])
        if (
          value[key] !== undefined &&
          (!Array.isArray(value[key]) ||
            value[key].some((item) => typeof item !== "string"))
        )
          issue("server." + key, "Expected a string array");
      for (const key of ["delay", "shutdownTimeout", "requestTimeout"])
        if (
          value[key] !== undefined &&
          (!Number.isFinite(value[key]) || value[key] < 0)
        )
          issue("server." + key, "Expected a nonnegative number");
    }
  }
  for (const group of ["electron", "tauri"])
    if (object(config[group])) {
      checkKeys(config[group], configOptions[group], group + ".");
      if (
        config[group].action &&
        !(
          group === "electron"
            ? ["stage", "open", "package", "make"]
            : ["stage", "dev", "build"]
        ).includes(config[group].action)
      )
        issue(group + ".action", "Unknown native action");
      try {
        (group === "electron" ? electronLaunchOptions : tauriCommand)(
          config[group],
        );
      } catch (error) {
        issue(group, error.message);
      }
    }
  for (const group of ["native", "budgets", "diagnostics"])
    if (config[group] !== undefined) {
      if (!object(config[group])) issue(group, "Expected an object");
      else checkKeys(config[group], configOptions[group], group + ".");
    }
  for (const [name, task] of Object.entries(config.tasks || {})) {
    if (!object(task)) issue("tasks." + name, "Expected a task object");
    else checkKeys(task, configOptions.tasks, "tasks." + name + ".");
  }
  if (config.remotes !== undefined) {
    if (!object(config.remotes))
      issue("remotes", "Expected named SSH host presets");
    else
      for (const [name, preset] of Object.entries(config.remotes)) {
        try {
          remotePlan(preset);
        } catch (error) {
          issue("remotes." + name, error.message);
        }
        if (object(preset))
          checkKeys(
            preset,
            [
              "host",
              "directory",
              "platform",
              "command",
              "forwards",
              "port",
              "identityFile",
              "ready",
            ],
            "remotes." + name + ".",
          );
      }
  }
  if (
    config.copy !== undefined &&
    (!Array.isArray(config.copy) ||
      config.copy.some(
        (item) =>
          !object(item) ||
          typeof item.from !== "string" ||
          typeof item.to !== "string",
      ))
  )
    issue(
      "copy",
      "Expected [{from:'public', to:'dist'}]; files use an exact destination, directories copy their contents",
    );
  return { errors, warnings };
}
export function assertConfig(config, options = {}) {
  const result = validateConfig(config, options);
  for (const warning of result.warnings)
    options.onWarning?.(warning.path + ": " + warning.message);
  if (result.errors.length) {
    const error = new Error(
      "Invalid tinybuild configuration:\n" +
        result.errors
          .map((item) => "  " + item.path + ": " + item.message)
          .join("\n"),
    );
    error.issues = result;
    throw error;
  }
  return result;
}
