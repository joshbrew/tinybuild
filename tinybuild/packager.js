export * from "./esbuild/bundler.js";
export * from "./esbuild/streamingImportsPlugin.js";
export * from "./esbuild/workerPlugin.js";
export * from "./esbuild/installerPlugin.js";
export * from "./esbuild/runtimeAssetsPlugin.js";
export * from "./esbuild/hotswap/hotreloadPlugin.js";
export * from "./esbuild/hotswap/hotswapBundler.js";
export * from "./node_server/server.js";
export * from "./repo.js";
export * from "./native.js";
export * from "./config.js";
export * from "./native-config.js";
export * from "./devices.js";
export * from "./diagnostics.js";
export * from "./tasks.js";
export * from "./mobile.js";
export * from "./config-options.js";
export * from "./outputs.js";
export * from "./preview.js";
export * from "./native-presets.js";
export * from "./mobile-smoke.js";
export * from "./configure.js";
export * from "./desktop.js";
export * from "./server-tools.js";
export * from "./remote.js";
export * from "./notarization.js";
export * from "./option-reference.js";
export * from "./starters.js";
export * from "./project-check.js";
export * from "./doctor.js";

import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import chokidar from "chokidar";
import { bundle, createBuildContexts } from "./esbuild/bundler.js";
import { defaultServer, serve } from "./node_server/server.js";
import { defaultBundler } from "./esbuild/bundler.js";
import { isWatchedFile } from "./repo.js";
import { mergeConfig, loadConfig } from "./config.js";
import { packageNative, generatePWA } from "./native.js";
import { resolveNativeConfig } from "./native-config.js";
import { analyzeBuild, writeBuildReport } from "./diagnostics.js";
import { startTasks, taskOrder } from "./tasks.js";
import { developmentURLs } from "./devices.js";
import { mobileDevelopment } from "./mobile.js";
import { desktopDevelopment } from "./desktop.js";
import { assertConfig } from "./config-options.js";
import { copyAssets, recordOutputs, inside } from "./outputs.js";
import { serverRoot } from "./server-tools.js";

export const defaultConfig = {
  bundler: {
    entryPoints: ["index.js"],
    outfile: "dist/index",
    bundleBrowser: true,
    sourcemap: false,
    minify: true,
  },
  server: { ...defaultServer },
};
export async function packager(input = defaultConfig, options = {}) {
  // Legacy exitOnBundle is accepted; library functions never terminate the host.
  if (typeof options === "boolean") options = {};
  const expanded = resolveNativeConfig(mergeConfig({}, input));
  let config = expanded.serve
    ? {
        ...expanded,
        bundler: false,
        electron: false,
        tauri: false,
        mobile: false,
      }
    : desktopDevelopment(mobileDevelopment(expanded));
  assertConfig(config, { onWarning: options.onWarning || console.warn });
  const cwd = path.resolve(
    options.cwd || config.bundler?.absWorkingDir || process.cwd(),
  );
  const watching =
    options.watch ??
    Boolean(
      config.server &&
      config.server.hotreload !== false &&
      !config.build &&
      !config.serve &&
      !config.production &&
      !config.server.production,
    );
  let contexts,
    watcher,
    server,
    closed = false,
    pending = new Set(),
    running,
    timer;
  let workspace,
    closing,
    nativeStarted = false;
  const lifetime = new AbortController();
  const nativeSignal = AbortSignal.any([
    lifetime.signal,
    ...(options.signal ? [options.signal] : []),
    ...(options.native?.signal ? [options.native.signal] : []),
  ]);
  const checkAborted = () => {
    if (closed || options.signal?.aborted)
      throw new Error("Tinybuild startup aborted");
  };
  taskOrder(config.tasks);
  let fingerprints = new Map();
  let builtFingerprints = new Map();
  let dependencyFiles = new Set();
  let buildId = 0;
  let sequence = 0;
  let failedBuild = false;
  let configurationFailed = false;
  let unsettledBuild = false;
  const staticChanges = new Set();
  const staticFile = (filename) =>
    /\.(?:html?|xml|css|png|jpe?g|gif|svg|ico|webp|txt|json|webmanifest|wasm|woff2?|ttf|mp[34]|webm|wav|pdf)$/i.test(
      filename,
    );
  function event(type, details = {}) {
    options.onEvent?.({
      schemaVersion: 1,
      type,
      sequence: ++sequence,
      time: new Date().toISOString(),
      ...details,
    });
  }
  function buildError(error) {
    event("build-error", { error: { message: error.message } });
  }
  function trace(action, message, details = {}) {
    if (!config.server?.debug) return;
    event("reload", { action, message, ...details });
    (options.log || console.log)("Reload: " + message);
  }
  const relativeFiles = (files) =>
    files.map((file) =>
      path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join("/"),
    );
  let resolveFirstBuild;
  const firstBuild = new Promise((resolve) => {
    resolveFirstBuild = resolve;
  });
  const generatedFiles = new Set();
  const scheduledTasks = new Set();
  const controller = {
    bundles: [],
    server: undefined,
    stats: { builds: 0, durationMs: 0, outputBytes: 0, files: [] },
  };
  function abort() {
    controller.close().catch((error) => options.onError?.(error));
  }
  function buildConfig() {
    const values = config.bundler ?? defaultBundler;
    return Array.isArray(values)
      ? values.map((value) => ({
          ...value,
          absWorkingDir: value.absWorkingDir || cwd,
        }))
      : { ...values, absWorkingDir: values.absWorkingDir || cwd };
  }
  function broadcast(message) {
    server?.SOCKETS.hotreload?.broadcast(message);
  }
  async function outputsChanged(results) {
    const next = new Map();
    const files = [];
    const dependencies = new Set();
    for (const group of results)
      for (const result of Object.values(group)) {
        if (!result?.metafile) continue;
        const buildCwd = group.config.absWorkingDir || cwd;
        for (const filename of Object.keys(result.metafile.inputs))
          dependencies.add(path.resolve(buildCwd, filename));
        for (const filename of Object.keys(result.metafile.outputs)) {
          const absolute = path.resolve(buildCwd, filename);
          try {
            const hash = createHash("sha256")
              .update(await fs.readFile(absolute))
              .digest("hex");
            next.set(absolute, hash);
            if (fingerprints.get(absolute) !== hash) files.push(absolute);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
        if (result.html)
          next.set(
            result.html,
            createHash("sha256")
              .update(await fs.readFile(result.html))
              .digest("hex"),
          );
      }
    for (const filename of fingerprints.keys())
      if (!next.has(filename)) files.push(filename);
    for (const [filename, hash] of next)
      if (filename.endsWith(".html") && fingerprints.get(filename) !== hash)
        files.push(filename);
    builtFingerprints = next;
    dependencyFiles = dependencies;
    return [...new Set(files)];
  }
  function publicFiles(files) {
    const root = serverRoot(
      {
        ...config.server,
        production: config.production ?? config.server?.production,
      },
      cwd,
    );
    return files.map((filename) => {
      const absolute = path.resolve(cwd, filename);
      const mounts = Object.entries(config.server?.staticRoots || { "/": root })
        .map(([prefix, value]) => ({
          prefix,
          directory: path.resolve(cwd, value),
        }))
        .sort((a, b) => b.directory.length - a.directory.length);
      for (const mount of mounts) {
        const relative = path.relative(mount.directory, absolute);
        if (
          relative !== ".." &&
          !relative.startsWith(".." + path.sep) &&
          !path.isAbsolute(relative)
        )
          return (
            mount.prefix.replace(/\/$/, "") +
            "/" +
            relative.split(path.sep).join("/")
          );
      }
      return "/" + path.relative(root, absolute).split(path.sep).join("/");
    });
  }
  function ignoredPaths() {
    const values = Array.isArray(config.bundler)
      ? config.bundler
      : [config.bundler || defaultBundler];
    return [
      ...values
        .flatMap((value) => {
          const working = path.resolve(value.absWorkingDir || cwd);
          const outfile = value.outfile || defaultBundler.outfile;
          const directory = path.resolve(
            working,
            value.outdir || path.dirname(outfile),
          );
          if (!inside(directory, cwd)) return [directory];
          return value.outdir
            ? []
            : [outfile + ".js", outfile + ".css"].map((file) =>
                path.resolve(working, file),
              );
        })
        .filter(Boolean),
      ...(config.electron
        ? [
            path.resolve(
              cwd,
              typeof config.electron === "string"
                ? config.electron
                : config.electron.directory || "electron",
              "web",
            ),
          ]
        : []),
      ...(config.server?.ignore || []),
      ...(config.copy || []).map((item) => item.to),
      ...generatedFiles,
      ...(config.server?.pwa
        ? [
            path.resolve(
              serverRoot(
                {
                  ...config.server,
                  production: config.production ?? config.server?.production,
                },
                cwd,
              ),
              config.server.pwa,
            ),
          ]
        : []),
      config.diagnostics?.report,
      ".tinybuild",
    ].filter(Boolean);
  }
  async function build(changed = []) {
    if (config.serve) return [];
    for (const filename of changed)
      if (
        staticFile(filename) &&
        !dependencyFiles.has(path.resolve(cwd, filename))
      )
        staticChanges.add(path.resolve(cwd, filename));
    event("building", {
      files: changed.map((file) =>
        path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join("/"),
      ),
    });
    const started = performance.now();
    if (watching && config.bundler !== false && !contexts)
      contexts = await createBuildContexts(buildConfig());
    const results =
      config.bundler === false
        ? []
        : watching
          ? await contexts.rebuild()
          : await bundle(buildConfig());
    const builtFiles = results.flatMap((group) =>
      Object.values(group).flatMap((result) =>
        result?.metafile && group.config.write !== false
          ? [
              ...Object.keys(result.metafile.outputs).map((file) =>
                path.resolve(group.config.absWorkingDir || cwd, file),
              ),
              ...(result.html ? [result.html] : []),
              ...(result.gzipFiles || []),
            ]
          : [],
      ),
    );
    builtFiles.push(
      ...results.flatMap((group) =>
        (group.ts?.outputs || []).map((item) =>
          path.resolve(group.config.absWorkingDir || cwd, item.path),
        ),
      ),
    );
    for (const file of builtFiles) generatedFiles.add(file);
    if (builtFiles.length) await recordOutputs(builtFiles, { cwd });
    const copied = await copyAssets(config.copy || [], { cwd });
    if (copied.files.length)
      results.push({ config: { absWorkingDir: cwd }, assets: copied });
    controller.bundles = results;
    if (server) {
      const html = results
        .flatMap((group) => Object.values(group))
        .find((result) => result?.html)?.html;
      if (html)
        server.setStartpage(
          path.relative(
            serverRoot(
              {
                ...config.server,
                production: config.production ?? config.server?.production,
              },
              cwd,
            ),
            html,
          ),
        );
      else
        server.setStartpage(
          config.server?.startpage || defaultServer.startpage,
        );
    }
    const files = [
      ...new Set([
        ...(await outputsChanged(results)),
        ...[...staticChanges].filter((file) => !dependencyFiles.has(file)),
      ]),
    ];
    if (config.server?.pwa) {
      const root = serverRoot(
        {
          ...config.server,
          production: config.production ?? config.server?.production,
        },
        cwd,
      );
      const pwa = await generatePWA({
        cwd,
        root,
        filename: path.resolve(root, config.server.pwa),
        results,
      });
      await recordOutputs([pwa.filename], { cwd });
    }
    const report = await analyzeBuild(results, {
      cwd,
      budgets: config.budgets,
      ...config.diagnostics,
    });
    if (config.diagnostics?.report) {
      const reportFile = await writeBuildReport(
        report,
        config.diagnostics.report,
        { cwd },
      );
      await recordOutputs([reportFile], { cwd, kind: "report" });
    }
    const outputBytes = report.outputBytes;
    controller.report = report;
    controller.stats = {
      builds: controller.stats.builds + 1,
      durationMs: performance.now() - started,
      outputBytes,
      files: publicFiles(files),
      reason: {
        type:
          controller.stats.builds === 0
            ? "initial"
            : changed.length
              ? changesConfiguration(changed)
                ? "config"
                : "files"
              : "manual",
        files: changed.map((file) =>
          path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join("/"),
        ),
      },
      violations: report.violations,
    };
    if (report.violations.length)
      (options.onWarning || console.warn)(
        "Build budget exceeded: " +
          report.violations.map((item) => item.path).join(", "),
      );
    if (config.stats)
      (options.log || console.log)(
        "Built " +
          outputBytes +
          " bytes in " +
          controller.stats.durationMs.toFixed(1) +
          " ms",
      );
    // A save received during this build belongs to the next settled batch.
    // Do not send an intermediate page reload that would immediately be replaced.
    if (!pending.size && !closed) {
      failedBuild = false;
      unsettledBuild = false;
      staticChanges.clear();
      server?.setReady(true);
      fingerprints = builtFingerprints;
      resolveFirstBuild();
      options.onBuild?.(controller.stats);
      event("built", {
        stats: controller.stats,
        ...(server ? { url: server.url } : {}),
      });
      broadcast({
        type: "built",
        id: ++buildId,
        files: publicFiles(files),
        reloadscripts: config.server?.reloadscripts,
      });
    } else {
      unsettledBuild = true;
      if (!closed)
        trace(
          "queued",
          "More saves arrived during compilation; waiting for the next batch before refreshing.",
          { files: relativeFiles([...pending]) },
        );
    }
    return results;
  }
  async function rebuild(changed = []) {
    if (closed) return;
    if (running) {
      for (const filename of changed) pending.add(filename);
      return running;
    }
    running = (async () => {
      try {
        return await build(changed);
      } catch (error) {
        failedBuild = true;
        server?.setReady(false);
        buildError(error);
        if (!pending.size)
          broadcast({ type: "error", id: ++buildId, message: error.message });
        options.onError?.(error);
        throw error;
      }
    })();
    try {
      return await running;
    } finally {
      running = undefined;
      if (pending.size && !closed) schedule();
    }
  }
  function changesConfiguration(changed) {
    return (
      options.configPath &&
      changed.some(
        (file) =>
          path.resolve(cwd, file) === path.resolve(cwd, options.configPath),
      )
    );
  }
  function schedule() {
    if (closed || scheduledTasks.size || running) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (closed) return;
      const task = flushChanges();
      scheduledTasks.add(task);
      task
        .finally(() => {
          scheduledTasks.delete(task);
          if (pending.size && !closed) schedule();
        })
        .catch(() => {});
    }, config.server?.delay ?? defaultServer.delay);
  }
  async function flushChanges() {
    if (running) return;
    const changes = [...pending];
    pending.clear();
    trace(
      "batch",
      "Grouped " +
        changes.length +
        " changed file(s) after " +
        (config.server?.delay ?? defaultServer.delay) +
        " ms of quiet: " +
        relativeFiles(changes).join(", "),
      {
        files: relativeFiles(changes),
        delay: config.server?.delay ?? defaultServer.delay,
      },
    );
    let rebuildStarted = false;
    for (const filename of changes)
      if (staticFile(filename) && !dependencyFiles.has(path.resolve(filename)))
        staticChanges.add(path.resolve(filename));
    try {
      if (
        options.configPath &&
        (configurationFailed ||
          changes.some(
            (filename) =>
              path.resolve(filename) === path.resolve(cwd, options.configPath),
          ))
      ) {
        configurationFailed = true;
        const next = desktopDevelopment(
          mobileDevelopment(
            resolveNativeConfig(
              mergeConfig(
                await loadConfig(options.configPath, cwd, true),
                options.overrides || {},
              ),
            ),
          ),
        );
        assertConfig(next, { onWarning: options.onWarning || console.warn });
        taskOrder(next.tasks);
        if (closed) return;
        const previous = config;
        // A running native shell retains its launch URL and SDK settings.
        // Keep its working session intact instead of silently half-applying edits.
        const nativeSettings = (value) => [
          value.native,
          value.electron || false,
          value.tauri || false,
          value.mobile || false,
          Boolean(value.build),
          Boolean(value.serve),
          Boolean(value.production),
          Boolean(value.server?.production),
          value.server?.host ?? defaultServer.host,
          value.server?.port ?? defaultServer.port,
          value.server?.protocol ?? defaultServer.protocol,
        ];
        if (
          (nativeStarted || controller.native) &&
          !isDeepStrictEqual(nativeSettings(previous), nativeSettings(next))
        )
          throw new Error(
            "Native app or server address settings changed. Restart tinybuild to apply them; the current native session is still running.",
          );
        const previousPort = server?.port;
        const serverSettings = (value) =>
          value.server === false
            ? false
            : { ...defaultServer, ...value.server };
        const serverChanged =
          !isDeepStrictEqual(serverSettings(previous), serverSettings(next)) ||
          previous.production !== next.production ||
          previous.build !== next.build;
        const tasksChanged =
          !isDeepStrictEqual(previous.tasks, next.tasks) ||
          previous.build !== next.build;
        const services = [
          serverChanged && "server",
          tasksChanged && "tasks",
        ].filter(Boolean);
        trace(
          "config",
          services.length
            ? "Config changed; replacing " + services.join(" and ") + "."
            : "Config changed; keeping the current server and tasks.",
          { services },
        );
        await contexts?.dispose();
        contexts = undefined;
        if (closed) return;
        try {
          if (tasksChanged) {
            await workspace?.close();
            workspace = undefined;
            if (closed) return;
            if (next.tasks && !next.build)
              workspace = await startTasks(next.tasks, {
                cwd,
                signal: options.signal,
                onError: options.onError,
                ...options.tasks,
              });
          }
          if (serverChanged) {
            await server?.close();
            server = undefined;
            controller.server = undefined;
            if (closed) return;
            if (next.server !== false && !next.build)
              server = await serve({
                cwd,
                ...next.server,
                ...(next.server?.port === 0 && previousPort
                  ? { port: previousPort }
                  : {}),
                production: next.production ?? next.server?.production,
              });
          }
        } catch (error) {
          // A bad replacement must not leave a previously working dev session down.
          if (!closed) {
            if (tasksChanged) {
              await workspace?.close();
              workspace = undefined;
              if (previous.tasks && !previous.build)
                workspace = await startTasks(previous.tasks, {
                  cwd,
                  signal: options.signal,
                  onError: options.onError,
                  ...options.tasks,
                });
            }
            if (
              serverChanged &&
              !server &&
              previous.server !== false &&
              !previous.build
            )
              server = await serve({
                cwd,
                ...previous.server,
                ...(previousPort ? { port: previousPort } : {}),
                production: previous.production ?? previous.server?.production,
              });
          }
          controller.server = server;
          controller.tasks = workspace;
          throw error;
        }
        controller.server = server;
        controller.tasks = workspace;
        config = next;
        configurationFailed = false;
        if (watching) await refreshWatcher();
        rebuildStarted = true;
        await rebuild(changes);
      } else if (
        failedBuild ||
        unsettledBuild ||
        changes.some(
          (filename) =>
            dependencyFiles.has(path.resolve(filename)) ||
            (config.copy || []).some((item) =>
              inside(path.resolve(cwd, item.from), path.resolve(filename)),
            ) ||
            !staticFile(filename),
        )
      ) {
        trace(
          "rebuild",
          failedBuild
            ? "Retrying after a build error."
            : unsettledBuild
              ? "Compiling saves queued during the previous build."
              : "Source or copied assets changed; rebuilding with the current server.",
          { files: relativeFiles(changes) },
        );
        rebuildStarted = true;
        await rebuild(changes);
      } else {
        trace(
          "static",
          "Only static files changed; refreshing without compilation.",
          { files: relativeFiles(changes) },
        );
        event("built", {
          files: publicFiles(changes),
          ...(server ? { url: server.url } : {}),
        });
        broadcast({
          type: "built",
          id: ++buildId,
          files: publicFiles(changes),
          reloadscripts: config.server?.reloadscripts,
        });
        staticChanges.clear();
      }
    } catch (error) {
      // rebuild reports its own failure. Only config/static failures reach here
      // without already notifying clients and the caller's error callback.
      if (!rebuildStarted) {
        buildError(error);
        broadcast({ type: "error", id: ++buildId, message: error.message });
        options.onError?.(error);
      }
    }
  }
  async function refreshWatcher() {
    await watcher?.close();
    if (closed) return;
    checkAborted();
    watcher = chokidar.watch(
      [
        cwd,
        ...(config.server?.watch || []).map((filename) =>
          path.resolve(cwd, filename),
        ),
        ...(config.copy || []).map((item) => path.resolve(cwd, item.from)),
      ],
      {
        ignoreInitial: true,
        ignored: (filename) =>
          !isWatchedFile(filename, {
            cwd,
            ignore: ignoredPaths(),
            watchPaths: [
              ...(config.server?.watch || []),
              ...(config.copy || []).map((item) => item.from),
            ],
          }),
        awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
      },
    );
    controller.watcher = watcher;
    watcher.on("all", (event, filename) => {
      const isConfig =
        options.configPath &&
        path.resolve(filename) === path.resolve(cwd, options.configPath);
      if (
        !["add", "change", "unlink"].includes(event) ||
        (!isConfig &&
          (!config.server ||
            config.server.hotreload === false ||
            config.production ||
            config.server.production ||
            config.build ||
            config.serve)) ||
        !isWatchedFile(filename, {
          cwd,
          ignore: ignoredPaths(),
          extensions: isConfig ? [] : config.server?.extensions || [],
          watchPaths: [
            ...(config.server?.watch || []),
            ...(config.copy || []).map((item) => item.from),
          ],
        })
      )
        return;
      pending.add(filename);
      schedule();
    });
    watcher.on("error", (error) => options.onError?.(error));
    await new Promise((resolve, reject) => {
      const ready = () => {
        watcher.removeListener("error", failed);
        resolve();
      };
      const failed = (error) => {
        watcher.removeListener("ready", ready);
        reject(error);
      };
      watcher.once("ready", ready);
      watcher.once("error", failed);
    });
  }
  controller.rebuild = rebuild;
  controller.close = () =>
    (closing ||= (async () => {
      closed = true;
      lifetime.abort();
      options.signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
      const errors = [];
      const cleanup = async (operation) => {
        try {
          await operation();
        } catch (error) {
          errors.push(error);
        }
      };
      await cleanup(() => watcher?.close());
      await Promise.allSettled([...scheduledTasks]);
      await running?.catch(() => {});
      await cleanup(() => controller.native?.close?.());
      await cleanup(() => contexts?.dispose());
      await cleanup(() => server?.close());
      await cleanup(() => workspace?.close());
      event("closed");
      if (errors.length)
        throw new AggregateError(
          errors,
          "Tinybuild could not close every resource: " +
            errors.map((error) => error.message).join("; "),
        );
    })());
  try {
    checkAborted();
    if (config.tasks && !config.build) {
      workspace = await startTasks(config.tasks, {
        cwd,
        signal: options.signal,
        onError: options.onError,
        ...options.tasks,
      });
      controller.tasks = workspace;
    }
    if (watching) await refreshWatcher();
    let initialError;
    try {
      await rebuild();
    } catch (error) {
      if (!watching) throw error;
      initialError = error;
    }
    if (
      config.server !== false &&
      !config.build &&
      (config.server || config.bundler === undefined)
    ) {
      checkAborted();
      const html = controller.bundles
        .flatMap((result) => Object.values(result))
        .find((result) => result?.html)?.html;
      server = await serve({
        cwd,
        ...config.server,
        ...(html
          ? {
              startpage: path.relative(
                serverRoot(
                  {
                    ...config.server,
                    production: config.production ?? config.server?.production,
                  },
                  cwd,
                ),
                html,
              ),
            }
          : {}),
        production: config.production ?? config.server?.production,
      });
      controller.server = server;
      server.setReady(!initialError);
      if (initialError)
        broadcast({ type: "error", message: initialError.message });
    }
    checkAborted();
    controller.ready = Promise.resolve(controller);
    await options.onReady?.(controller);
    checkAborted();
    event("ready", {
      ok: !initialError,
      ...(server ? { url: server.url } : {}),
    });
    checkAborted();
    if (watching && (config.mobile || config.electron || config.tauri)) {
      await new Promise((resolve, reject) => {
        const cancelled = () => reject(new Error("Tinybuild startup aborted"));
        if (nativeSignal.aborted) {
          cancelled();
          return;
        }
        nativeSignal.addEventListener("abort", cancelled, { once: true });
        firstBuild.then(() => {
          nativeSignal.removeEventListener("abort", cancelled);
          resolve();
        });
      });
      checkAborted();
    }
    if (config.mobile || config.electron || config.tauri) {
      nativeStarted = true;
      controller.native = await packageNative(config, controller.bundles, {
        cwd,
        devUrl:
          server &&
          (config.native?.devHost ||
            ["0.0.0.0", "::"].includes(config.server?.host))
            ? developmentURLs(server.url, { host: config.native?.devHost })[0]
            : server?.url,
        ...options.native,
        signal: nativeSignal,
      });
      if (controller.native.artifacts.length)
        event("artifacts", { artifacts: controller.native.artifacts });
    }
    checkAborted();
    options.signal?.addEventListener("abort", abort, { once: true });
    return controller;
  } catch (error) {
    await controller.close();
    throw error;
  }
}
