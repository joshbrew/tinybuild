import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packager, defaultConfig } from "./packager.js";
import { parseArgs, get as rawArgs } from "./commands/command.js";
import * as commands from "./commands/index.js";
import { loadConfig, mergeConfig } from "./config.js";
import { checkBoilerPlate, initRepo, runAndWatch } from "./repo.js";
import { doctor, doctorReport } from "./doctor.js";
export { doctor } from "./doctor.js";
import { optionReference } from "./option-reference.js";
import { checkProject } from "./project-check.js";
import {
  addAgentGuide,
  initStarter,
  listStarters,
  scaffoldWorker,
} from "./starters.js";
import { resultRecord, errorRecord, outputContext } from "./reporting.js";
import { discoverDevices, developmentURLs, developmentQR } from "./devices.js";
import { benchmarkBuild, saveBaseline } from "./diagnostics.js";
import { selectNativeProfile } from "./native-config.js";
import { previewConfig } from "./preview.js";
import { assertConfig, configOptions } from "./config-options.js";
import { cleanGenerated } from "./outputs.js";
import { configure } from "./configure.js";
import { startRemote } from "./remote.js";
import {
  browserURL,
  openBrowser,
  loadEnvironment,
  probeServer,
} from "./server-tools.js";

function wrapped(text) {
  const lines = ["  "];
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (lines.at(-1).length + word.length + 1 > 88) lines.push("  ");
    lines[lines.length - 1] += (lines.at(-1).trim() ? " " : "") + word;
  }
  return lines.join("\n");
}
export function help() {
  return [
    "Usage: tinybuild [command] [--option value]",
    "Run tinybuild on its own to create missing starter files, build, serve and watch.",
    "",
    "Start here",
    "  dev --open             Start development and open the browser",
    "  config                 Choose common settings with a guided editor",
    "  init --list            Find a starter you can copy",
    "  init --example webworkers --dir demo",
    "                         Create a worker app in a new folder",
    "",
    "Build and check",
    "  build                  Build once and exit",
    "  serve                  Serve files that already exist",
    "  build --production     Build for deployment; no dependency downloads",
    "  serve --production     Serve production files; no live reload",
    "  preview                See resolved settings and planned commands",
    "  validate --strict      Catch misspelled or invalid settings",
    "  check --json           Build and check configured files and local URLs",
    "  options --search worker",
    "                         Explain matching settings from the full config",
    "  analyze                Inspect output sizes and dependencies",
    "  benchmark              Measure build times",
    "  baseline               Save build sizes for later comparisons",
    "  clean --dryRun         List generated files that can be removed",
    "",
    "Workers and native apps",
    "  init --worker src/flow.Worker --typescript",
    "                         Add a worker and its type declarations",
    "  desktop=electron       Launch Electron against the live server",
    "  desktop=tauri          Launch Tauri against the live server",
    "  mobile=android --device <id>",
    "                         Install and launch with mobile live reload",
    "  devices                List connected devices and available simulators",
    "  --remote mac --dryRun   Preview a configured SSH connection",
    "",
    "Troubleshoot",
    "  dev --debug            Explain grouped saves, rebuilds and service restarts",
    "  doctor --target android",
    "                         Check the tools for a target",
    "  doctor --report --json",
    "                         Collect selected settings and tool checks",
    "  status --url http://localhost:8080/_tinybuild/ready",
    "                         Check the readiness of a running server",
    "",
    "Options override the config: --port 8081, --port=8081 and port=8081 all work.",
    "Use --cfgpath app.mjs for another config; --envFile .env.local loads env values.",
    "--config takes inline JSON. --json prints versioned results or dev/build events.",
    "Add --dryRun to worker creation or --stage to project checks for native staging.",
    "",
    "All accepted options (use options --search <name> for explanations)",
    ...["basic", "bundler", "server"].map(
      (group) =>
        group + ":\n" + wrapped(Object.keys(commands[group]).join(", ")),
    ),
    "",
  ].join("\n");
}
export async function runTinybuild(args = process.argv.slice(2), options = {}) {
  const values = Array.isArray(args) ? parseArgs(args) : { ...args };
  return outputContext.run({ machine: values.json === true }, () =>
    executeTinybuild(values, options),
  );
}
function commandName(values) {
  if (values.init && values.list) return "init";
  if (values.mode === "help") return "help";
  const name = [
    "options",
    "configure",
    "clean",
    "devices",
    "help",
    "doctor",
    "init",
    "status",
    "remote",
    "check",
    "preview",
    "validate",
    "benchmark",
    "analyze",
    "baseline",
    "dev",
    "build",
    "serve",
  ].find((key) => values[key]);
  return name === "configure" ? "config" : name || "dev";
}
async function executeTinybuild(args, options) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const overrides = Array.isArray(args) ? parseArgs(args) : { ...args };
  const command = commandName(overrides);
  if (overrides.report && !overrides.doctor)
    throw new Error("Use doctor --report to collect a support report");
  if (overrides.worker && (!overrides.init || overrides.list))
    throw new Error("Use init --worker <name> without --list");
  const write = options.write || ((line) => console.log(line));
  const log = overrides.json ? console.error : options.log || console.log;
  const print = (data, ok) =>
    write(
      JSON.stringify(
        overrides.json ? resultRecord(command, data, ok) : data,
        null,
        overrides.json ? undefined : 2,
      ),
    );
  if (overrides.options) {
    const result = optionReference(overrides.search);
    if (overrides.json) print(result);
    else {
      const common = new Set([
        "bundler.entryPoints",
        "bundler.outfile",
        "bundler.outdir",
        "bundler.minify",
        "bundler.sourcemap",
        "server.port",
        "server.hotreload",
        "server.delay",
      ]);
      const shown = overrides.search
        ? result
        : result.filter((item) => common.has(item.path));
      for (const item of shown) {
        log(item.path);
        log(wrapped(item.description));
        if (item.type)
          log(
            wrapped(
              "Accepts: " +
                ({
                  boolean: "true or false",
                  number: "a number",
                  string: "text in quotes",
                  "string[]": "a list of text values",
                }[item.type] || item.type),
            ),
          );
        if (Object.hasOwn(item, "default"))
          log(wrapped("Default when omitted: " + JSON.stringify(item.default)));
        log(
          wrapped(
            "Example value: " +
              (item.example === "{"
                ? "{ ... }"
                : item.example === "["
                  ? "[ ... ]"
                  : item.example),
          ) + "\n",
        );
      }
      if (!shown.length)
        log(
          wrapped(
            "No settings match. Try tinybuild options --search port, or read tinybuild.config.js.",
          ),
        );
      else if (!overrides.search)
        log(
          wrapped(
            "Showing common settings. Search all " +
              result.length +
              " with tinybuild options --search <word>. Use --json for the complete list.",
          ),
        );
    }
    return result;
  }
  if (overrides.init && overrides.list) {
    const result = listStarters(overrides.search);
    if (overrides.json) print(result);
    else {
      for (const recipe of result)
        log(recipe.name.padEnd(18) + recipe.description);
      if (result.length)
        log("\nCreate one: tinybuild init --example <name> --dir my-app");
      else
        log(
          "No starters match this search. Run tinybuild init --list to see them all.",
        );
    }
    return result;
  }
  if (overrides.build && overrides.serve)
    throw new Error("Choose build or serve for one invocation");
  if (overrides.build) overrides.serve = false;
  if (overrides.serve) overrides.build = false;
  if (overrides.dev) {
    if (overrides.build || overrides.serve || overrides.production)
      throw new Error(
        "Choose dev, build or serve; dev cannot use --production",
      );
    Object.assign(overrides, { build: false, serve: false, production: false });
    overrides.server = {
      production: false,
      hotreload: true,
      ...overrides.server,
    };
  }
  if (overrides.envFile) await loadEnvironment(overrides.envFile, { cwd });
  if (overrides.configure) {
    const result = await configure({
      cwd,
      filename: overrides.cfgpath,
      edits: overrides.set,
      yes: overrides.yes,
      dryRun: overrides.dryRun,
      log,
      ...options.configure,
    });
    if (overrides.json) print(result);
    return result;
  }
  if (overrides.clean) {
    const result = await cleanGenerated({
      cwd,
      dryRun: Boolean(overrides.dryRun),
    });
    print(result);
    return result;
  }
  const inspecting = overrides.preview || overrides.validate || overrides.check;
  if (overrides.devices) {
    const devices = await discoverDevices(options.devices);
    print(devices);
    return devices;
  }
  if (overrides.analyze || overrides.benchmark || overrides.baseline)
    overrides.build = true;
  if (overrides.help || overrides.mode === "help") {
    if (overrides.json) print({ usage: help(), options: optionReference() });
    else log(help());
    return;
  }
  if (overrides.doctor) {
    const settings = {
      target: overrides.doctorTarget || overrides.bundler?.target || "browser",
      ...options.doctor,
    };
    if (overrides.report) {
      const filename =
        overrides.cfgpath ||
        [
          "tinybuild.config.js",
          "tinybuild.config.mjs",
          "tinybuild.config.cjs",
        ].find((name) => fs.existsSync(path.join(cwd, name)));
      let result;
      try {
        const config = filename
          ? await loadConfig(filename, cwd)
          : defaultConfig;
        result = doctorReport(mergeConfig(config, overrides), {
          cwd,
          ...settings,
        });
      } catch {
        // Syntax/import errors may embed source code and credentials.
        result = doctorReport(
          { bundler: false, server: false },
          { cwd, ...settings },
        );
        result.ok = false;
        result.configurationError =
          "Could not load config. Run tinybuild validate locally for details.";
      }
      print(result);
      return result;
    }
    const checks = doctor(cwd, settings);
    if (overrides.json)
      print(
        checks,
        checks.every((item) => item.ok || item.optional),
      );
    else {
      const remedies = new Set();
      for (const check of checks) {
        log(
          (check.ok ? "OK" : check.optional ? "OPTIONAL" : "MISSING") +
            "  " +
            check.name +
            (check.detail ? " — " + check.detail : ""),
        );
        if (!check.ok && !remedies.has(check.remedy)) {
          log(wrapped(check.remedy));
          remedies.add(check.remedy);
        }
      }
    }
    return checks;
  }
  if (overrides.init) {
    if (overrides.worker) {
      if (overrides.example)
        throw new Error("Choose --worker or --example per init command");
      const result = await scaffoldWorker(overrides.worker, {
        cwd: path.resolve(cwd, overrides.dir || "."),
        typescript: overrides.typescript,
        runtime: overrides.workerRuntime,
        dryRun: overrides.dryRun,
      });
      if (overrides.json) print(result);
      else {
        log(
          (result.dryRun ? "Would create:" : "Created:") +
            "\n" +
            result.files.map((file) => "  " + file).join("\n"),
        );
        log("\nUsage from a project-root entry:\n\n" + result.usage);
        if (result.runtime === "node")
          log(
            "\nRequired bundler settings:\n" +
              JSON.stringify(result.settings, null, 2),
          );
        for (const note of result.next) log(note);
      }
      return result;
    }
    if (overrides.example) {
      const result = await initStarter(overrides.example, {
        cwd: path.resolve(cwd, overrides.dir || "."),
        agentGuide: overrides.agentGuide,
      });
      if (overrides.json) print(result);
      else {
        log("Created " + result.recipe + " in " + result.cwd);
        log("\nOpen a terminal in that folder, then run:\n");
        for (const command of result.next) log("  " + command);
        log(
          "\n" +
            result.stop +
            " See README.md for the demo and tinybuild.config.js for settings.",
        );
      }
      return result;
    }
    const result = await initRepo(
      path.resolve(cwd, overrides.dir || "."),
      overrides.entry || ["index.js"],
      overrides.script && decodeURIComponent(overrides.script),
      undefined,
      overrides.core || overrides.includeCore,
    );
    if (overrides.agentGuide) await addAgentGuide(result);
    if (overrides.json) print({ cwd: result });
    else {
      log("Starter files ready in " + result);
      log("Open a terminal there, then run npm install and npm start.");
      log(
        "README.md shows which files to edit; tinybuild.config.js explains the settings.",
      );
    }
    return result;
  }
  if (overrides.status && overrides.url) {
    const result = await probeServer(overrides.url, {
      signal: options.signal,
      ...options.probe,
    });
    print(result, result.ready);
    return result;
  }
  // Explicit scripts retain isolated restart behavior for custom backends.
  if (
    !inspecting &&
    (overrides.start || overrides.path?.endsWith("tinybuild.js"))
  ) {
    return runAndWatch(
      overrides.path || "tinybuild.js",
      [],
      overrides.server?.ignore,
      overrides.server?.extensions,
      overrides.server?.delay,
      { cwd, watchPaths: overrides.server?.watch },
    );
  }
  let filename =
    overrides.cfgpath ||
    (overrides.path && !overrides.path.endsWith("tinybuild.js")
      ? overrides.path
      : undefined);
  if (!filename)
    filename = [
      "tinybuild.config.js",
      "tinybuild.config.mjs",
      "tinybuild.config.cjs",
    ].find((name) => fs.existsSync(path.join(cwd, name)));
  const localScript = path.join(cwd, "tinybuild.js");
  const packageEntry = fileURLToPath(
    new URL("../tinybuild.js", import.meta.url),
  );
  if (
    !filename &&
    !inspecting &&
    !overrides.build &&
    !overrides.serve &&
    !overrides.status &&
    !overrides.remote &&
    localScript !== packageEntry &&
    fs.existsSync(localScript)
  ) {
    return runAndWatch(
      localScript,
      [],
      overrides.server?.ignore,
      overrides.server?.extensions,
      overrides.server?.delay,
      { cwd, watchPaths: overrides.server?.watch },
    );
  }
  if (
    !filename &&
    !inspecting &&
    !overrides.status &&
    !overrides.remote &&
    !overrides.serve &&
    !overrides.production
  ) {
    await checkBoilerPlate(mergeConfig(defaultConfig, overrides), true, cwd);
    filename = "tinybuild.config.js";
  }
  const fileConfig = filename ? await loadConfig(filename, cwd) : undefined;
  const sources = {};
  function origins(value, source, prefix = "") {
    for (const [key, item] of Object.entries(value || {})) {
      if (!prefix && !configOptions.root.includes(key)) continue;
      const at = prefix + key;
      sources[at] =
        sources[at] && item && typeof item === "object" && !Array.isArray(item)
          ? sources[at] + " + " + source
          : source;
      if (
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        ["bundler", "server", "native"].includes(key)
      )
        origins(item, source, at + ".");
    }
  }
  origins(fileConfig, filename ? "config file: " + filename : "default");
  origins(overrides, "CLI override");
  let config = filename
    ? mergeConfig(fileConfig, overrides)
    : mergeConfig(defaultConfig, overrides);
  if (config.production || config.frozen) {
    const reason = config.production ? "production mode" : "frozen mode";
    sources["bundler.autoInstall"] = reason;
    sources["bundler.remoteImports.frozen"] = reason;
  }
  if (overrides.profile) {
    config = selectNativeProfile(config, overrides.profile);
    sources["native.profile"] = "native profile: " + overrides.profile;
  }
  if (overrides.remote) {
    assertConfig(config, { onWarning: options.onWarning || console.warn });
    if (!Object.hasOwn(config.remotes || {}, overrides.remote))
      throw new Error("Unknown remote preset: " + overrides.remote);
    const result = await startRemote(config.remotes[overrides.remote], {
      cwd,
      signal: options.signal,
      dryRun: Boolean(overrides.dryRun),
      onError: (error) => {
        console.error(error.message);
        process.exitCode = 1;
      },
      ...options.remote,
    });
    if (overrides.dryRun) print(result);
    else result.urls.forEach((url) => log("Forwarded address: " + url));
    return result;
  }
  if (overrides.status) {
    const settings = { ...defaultConfig.server, ...config.server };
    const url =
      overrides.url ||
      browserURL(
        settings.protocol +
          "://" +
          (settings.host.includes(":")
            ? "[" + settings.host + "]"
            : settings.host) +
          ":" +
          settings.port,
        settings.readinessPath,
      );
    const result = await probeServer(url, {
      signal: options.signal,
      ...options.probe,
    });
    print(result, result.ready);
    return result;
  }
  if (overrides.dev)
    config.server = {
      ...defaultConfig.server,
      ...(config.server || {}),
      ...overrides.server,
    };
  if (overrides.desktop) {
    if (!["electron", "tauri"].includes(overrides.desktop))
      throw new Error("Use desktop=electron or desktop=tauri");
    if (typeof overrides.mobile === "string")
      throw new Error("Choose a desktop or mobile debug shortcut per session");
    const target = overrides.desktop;
    config = {
      ...config,
      mobile: false,
      electron: false,
      tauri: false,
      server: { ...defaultConfig.server, ...(config.server || {}) },
      [target]: {
        ...(typeof config[target] === "object" ? config[target] : {}),
        action: target === "electron" ? "open" : "dev",
        liveReload: true,
        ...(target === "electron"
          ? {
              ...(overrides.devtools !== undefined
                ? { devtools: overrides.devtools }
                : {}),
              ...(overrides.inspect !== undefined
                ? { inspect: overrides.inspect }
                : {}),
            }
          : {}),
      },
    };
  }
  if (overrides.desktop === "tauri") {
    delete config.tauri.debug;
    delete config.tauri.noBundle;
    delete config.tauri.bundles;
  }
  if (typeof overrides.mobile === "string") {
    const platform = overrides.mobile;
    if (!["android", "ios"].includes(platform))
      throw new Error(
        "Use mobile=android or mobile=ios for a live debug session",
      );
    config = {
      ...config,
      electron: false,
      tauri: false,
      server: { ...defaultConfig.server, ...(config.server || {}) },
      mobile: {
        [platform]: {
          action: "run",
          liveReload: true,
          connection:
            overrides.connection ||
            (platform === "android" ? "usb" : "simulator"),
          ...(overrides.device ? { target: String(overrides.device) } : {}),
        },
      },
    };
  }
  if (overrides.lan || overrides.qr)
    config.server = { ...config.server, host: "0.0.0.0" };
  if (overrides.check) {
    assertConfig(config, {
      strict: overrides.strict || config.strictConfig,
      onWarning: options.onWarning || console.warn,
    });
    const result = await checkProject(config, {
      cwd,
      stage: Boolean(overrides.stage),
      signal: options.signal,
      onWarning: options.onWarning || console.warn,
    });
    if (overrides.json) print(result);
    else {
      const labels = {
        build: "Build",
        file: "File",
        url: "URL",
        "native-stage": "Native app files",
      };
      for (const step of result.steps)
        log(
          (step.skipped ? "SKIP" : "OK") +
            "  " +
            (labels[step.name] || step.name) +
            (step.path ? ": " + step.path : "") +
            (step.skipped
              ? step.name === "build"
                ? " (bundling is disabled)"
                : " (no native targets configured)"
              : ""),
        );
      log("Project checks passed.");
      if (
        result.steps.some(
          (step) => step.name === "native-stage" && !step.skipped,
        )
      )
        log("Staged app files. SDK, device and signing checks run separately.");
    }
    return result;
  }
  if (inspecting) {
    assertConfig(config, {
      strict: overrides.strict || config.strictConfig,
      onWarning: console.warn,
    });
    const result = previewConfig(config, {
      cwd,
      strict: overrides.strict || config.strictConfig,
      sources,
    });
    if (result.validation.errors.length)
      throw new Error(
        result.validation.errors
          .map((item) => item.path + ": " + item.message)
          .join("\n"),
      );
    print(overrides.preview ? result : result.validation);
    return result;
  }
  if (overrides.benchmark) {
    if (!config.bundler)
      throw new Error("Benchmark requires bundler configuration");
    const values = Array.isArray(config.bundler)
      ? config.bundler.map((value) => ({
          ...value,
          absWorkingDir: value.absWorkingDir || cwd,
        }))
      : {
          ...config.bundler,
          absWorkingDir: config.bundler.absWorkingDir || cwd,
        };
    const report = await benchmarkBuild(values, {
      iterations:
        overrides.benchmark === true ? 5 : Number(overrides.benchmark),
    });
    print(report);
    return report;
  }
  if (overrides.serve) {
    config.bundler = false;
    config.electron = config.tauri = config.mobile = false;
  }
  const baselineTarget =
    typeof overrides.baseline === "string"
      ? overrides.baseline
      : config.diagnostics?.baseline || "tinybuild.baseline.json";
  if (overrides.baseline) {
    config.diagnostics = { ...config.diagnostics, baseline: undefined };
    config.budgets = { ...config.budgets, growthBytes: undefined };
    config.electron = config.tauri = config.mobile = false;
  }
  let python;
  if (overrides.mode === "python" && !overrides.build && !overrides.serve) {
    const source = fileURLToPath(new URL("./python/", import.meta.url));
    const destination = path.join(cwd, "python");
    fs.cpSync(source, destination, { recursive: true, force: false });
    config.server = { ...config.server, python: config.server?.python || 7000 };
    python = runAndWatch(
      "python/server.py",
      [],
      ["dist", "node_modules"],
      ["py"],
      100,
      {
        cwd,
        command: process.env.PYTHON || "python",
        env: {
          ...process.env,
          TINYBUILD_ROOT: cwd,
          TINYBUILD_STARTPAGE: config.server.startpage || "index.html",
          TINYBUILD_PYTHON_PORT: String(config.server.python),
        },
      },
    );
    python.on("childError", (error) =>
      console.error("Python: " + error.message),
    );
  }
  let controller,
    readyController,
    startupError,
    browserOpened = false;
  async function announce(controller, details = true) {
    if (details && controller?.server && (overrides.lan || overrides.qr)) {
      const urls = developmentURLs(controller.server.url, options.network);
      controller.lanURLs = urls;
      urls.forEach((url) => log("Device URL: " + url));
      if (overrides.qr && urls.length) {
        const filename = path.join(cwd, ".tinybuild/dev-qr.svg");
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, await developmentQR(urls[0]));
        log("Development QR: " + filename);
      }
    }
    if (controller?.server)
      log("Tinybuild listening at " + controller.server.url);
    if (details && controller?.server?.open && !browserOpened) {
      browserOpened = true;
      try {
        await (options.openBrowser || openBrowser)(
          browserURL(controller.server.url, controller.server.open),
        );
      } catch (error) {
        (options.onWarning || console.warn)(
          "Could not open the browser: " + error.message,
        );
      }
    }
  }
  try {
    controller = await packager(config, {
      cwd,
      configPath: filename,
      overrides:
        typeof overrides.mobile === "string" || overrides.desktop
          ? {
              ...overrides,
              mobile: config.mobile,
              electron: config.electron,
              tauri: config.tauri,
              server: {
                ...overrides.server,
                ...(overrides.lan || overrides.qr ? { host: "0.0.0.0" } : {}),
              },
            }
          : overrides,
      onError: (error) => {
        if (readyController) console.error(error.message);
        else startupError = error;
      },
      ...options,
      log,
      onEvent: (event) => {
        if (overrides.json) write(JSON.stringify(event));
        else if (event.type === "artifacts") {
          for (const artifact of event.artifacts) {
            log(
              "Native output: " +
                artifact.directory +
                (artifact.exists ? "" : " (not present)"),
            );
            for (const entry of artifact.entries)
              log("  " + entry.path + (entry.type === "directory" ? "/" : ""));
          }
          log(
            "Distribute complete app folders, including their resources and sidecars.",
          );
        }
        options.onEvent?.(event);
      },
      onReady: async (app) => {
        readyController = app;
        if (startupError) {
          console.error(startupError.message);
          startupError = undefined;
        }
        await options.onReady?.(app);
        await announce(app);
      },
      onBuild: (stats) => {
        options.onBuild?.(stats);
        if (readyController?.server)
          log("Tinybuild listening at " + readyController.server.url);
      },
    });
    // Native commands may finish much later than onReady; repeat the URL then.
    if (controller.native) await announce(controller, false);
  } catch (error) {
    await python?.close();
    throw error;
  }
  if (python) {
    const close = controller.close;
    controller.python = python;
    controller.close = async () => {
      await close();
      await python.close();
    };
  }
  if (
    overrides.build &&
    !overrides.json &&
    !overrides.analyze &&
    !overrides.baseline &&
    controller.report?.outputs.length
  ) {
    const outputs = controller.report.outputs;
    log(
      "Built " +
        outputs.length +
        " file" +
        (outputs.length === 1 ? "" : "s") +
        ":",
    );
    for (const file of outputs.slice(0, 8))
      log("  " + file.path + " (" + file.bytes + " bytes)");
    if (outputs.length > 8)
      log(
        "  " +
          (outputs.length - 8) +
          " more; tinybuild analyze lists every output.",
      );
  }
  if (overrides.analyze) print(controller.report);
  if (overrides.baseline) {
    log(
      "Build baseline: " +
        (await saveBaseline(controller.report, baselineTarget, { cwd })),
    );
  }
  return controller;
}
export async function main(args = process.argv.slice(2)) {
  let controller;
  let json = false,
    command = "dev";
  // If typed parsing fails, retain raw output flags so malformed JSON/config
  // arguments can still receive a machine-readable error response.
  try {
    const raw = rawArgs(args);
    json = raw.json === true || raw.json === "true";
    command = commandName(raw);
  } catch {
    /* The typed parse below reports the invalid argument. */
  }
  const failure = (error) =>
    json
      ? console.log(JSON.stringify(errorRecord(command, error)))
      : console.error(error.message);
  const abort = new AbortController();
  const stop = async () => {
    await controller?.close?.();
  };
  const cleanup = () => {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  };
  const shutdown = async () => {
    abort.abort();
    try {
      await stop();
    } catch (error) {
      failure(error);
      process.exitCode = 1;
    } finally {
      cleanup();
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    const values = parseArgs(args);
    json = Boolean(values.json);
    command = commandName(values);
    controller = await runTinybuild(values, { signal: abort.signal });
    if (
      controller?.ok === false ||
      (Array.isArray(controller) &&
        controller.some((item) => item.ok === false && !item.optional))
    )
      process.exitCode = 1;
    if (
      controller &&
      Object.hasOwn(controller, "ready") &&
      controller.ready === false &&
      Object.hasOwn(controller, "status")
    )
      process.exitCode = 1;
    if (
      !controller?.close ||
      (!controller.server &&
        !controller.watcher &&
        !controller.process &&
        !controller.tasks &&
        !controller.native?.watched?.electron?.length)
    ) {
      await stop();
      cleanup();
    }
  } catch (error) {
    if (!abort.signal.aborted) {
      failure(error);
      process.exitCode = 1;
    }
    try {
      await stop();
    } finally {
      cleanup();
    }
  }
}
