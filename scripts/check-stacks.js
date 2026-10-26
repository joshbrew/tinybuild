import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../tinybuild/config.js";
import { packager } from "../tinybuild/packager.js";
import { runPackageCommand } from "../tinybuild/process.js";
import { inside } from "../tinybuild/outputs.js";

const repository = fileURLToPath(new URL("../", import.meta.url));
export const stackCases = [
  { name: "webgpujs", configs: ["tinybuild.config.js"] },
  { name: "uplot-webgpu", configs: ["tinybuild.config.js"] },
  {
    name: "vibe_code_experiments/noiseCompute",
    configs: ["tinybuild.config.js"],
  },
  { name: "webgl-plot-utils", configs: ["tinybuild.config.js"] },
  {
    name: "myalyce_dev",
    configs: ["tinybuild.config.js", "backend/tinybuild.config.js"],
  },
  { name: "autogpt_web_dev_server", configs: ["tinybuild.config.js"] },
  {
    name: "banglejs_server_test",
    configs: ["tinybuild.config.js", "backend/tinybuild.config.js"],
  },
];
const excluded = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "release",
  "android",
  "ios",
  "electron",
  "src-tauri",
  "mobile_dist",
  ".tinybuild",
  ".venv",
  "venv",
  "__pycache__",
]);
export function copyStackFile(relative) {
  const parts = relative.split(/[\\/]/);
  return (
    !parts.some((part) => excluded.has(part) || /^\.env(?:\.|$)/i.test(part)) &&
    !/\.(?:pem|key|pfx|jks|p12)$/i.test(relative)
  );
}

export async function checkStacks({
  root = path.dirname(repository),
  install = false,
  reuse = false,
  names = stackCases.map((item) => item.name),
  run = runPackageCommand,
} = {}) {
  const cache = path.join(repository, ".test-stacks");
  await fs.mkdir(cache, { recursive: true });
  const report = [];
  for (const definition of stackCases.filter((item) =>
    names.includes(item.name),
  )) {
    const source = path.resolve(root, definition.name);
    const destination = path.join(cache, definition.name);
    if (
      !inside(cache, destination) ||
      destination === cache ||
      inside(source, destination)
    )
      throw new Error("Unsafe stack copy destination");
    const entry = {
      name: definition.name,
      source,
      configurations: [],
      status: "passed",
    };
    report.push(entry);
    try {
      await fs.access(path.join(source, "package.json"));
      const sourceHashes = new Map();
      for (const relative of definition.configs)
        sourceHashes.set(
          relative,
          createHash("sha256")
            .update(await fs.readFile(path.join(source, relative)))
            .digest("hex"),
        );
      if (
        !reuse ||
        !(await fs.access(path.join(destination, "package.json")).then(
          () => true,
          () => false,
        ))
      ) {
        await fs.rm(destination, { recursive: true, force: true });
        await fs.cp(source, destination, {
          recursive: true,
          filter: async (filename) =>
            copyStackFile(path.relative(source, filename)) &&
            !(await fs.lstat(filename)).isSymbolicLink(),
        });
      }
      for (const relative of definition.configs) {
        const cwd = path.dirname(path.join(destination, relative));
        const result = {
          config: relative,
          sourceHash: sourceHashes.get(relative),
          status: "passed",
        };
        entry.configurations.push(result);
        try {
          if (
            install &&
            !(
              reuse &&
              (await fs.access(path.join(cwd, "node_modules")).then(
                () => true,
                () => false,
              ))
            )
          ) {
            const args = ["ci", "--ignore-scripts", "--no-audit", "--no-fund"];
            try {
              await run(args, { cwd, manager: "npm" });
            } catch {
              await run(
                ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
                { cwd, manager: "npm" },
              );
            }
          }
          const config = await loadConfig(
            path.join(destination, relative),
            cwd,
            true,
          );
          if (config.bundler && Array.isArray(config.bundler))
            config.bundler = config.bundler.map((value) => ({
              ...value,
              autoInstall: false,
            }));
          else if (config.bundler)
            config.bundler = { ...config.bundler, autoInstall: false };
          const warnings = [];
          const app = await packager(
            {
              ...config,
              build: true,
              serve: false,
              server: false,
              electron: false,
              tauri: false,
              mobile: false,
            },
            { cwd, onWarning: (warning) => warnings.push(warning) },
          );
          try {
            result.outputBytes = app.report.outputBytes;
            result.outputs = app.report.outputs.map((output) => output.path);
            result.warnings = warnings;
            if (config.bundler !== false && !result.outputs.length)
              throw new Error("Stack produced no build outputs");
          } finally {
            await app.close();
          }
          console.log("PASS " + definition.name + "/" + relative);
        } catch (error) {
          result.status = "failed";
          result.error = error.message;
          entry.status = "failed";
          console.error(
            "FAIL " + definition.name + "/" + relative + ": " + error.message,
          );
        }
      }
      for (const [relative, hash] of sourceHashes)
        if (
          createHash("sha256")
            .update(await fs.readFile(path.join(source, relative)))
            .digest("hex") !== hash
        )
          throw new Error(
            "Source stack config changed during isolated checks: " + relative,
          );
    } catch (error) {
      entry.status = "failed";
      entry.error = error.message;
      console.error("FAIL " + definition.name + ": " + error.message);
    }
    await fs.writeFile(
      path.join(cache, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  if (report.length !== names.length)
    throw new Error("Unknown stack selection");
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const value = (name) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const report = await checkStacks({
    root: value("--root"),
    install: args.includes("--install"),
    reuse: args.includes("--reuse"),
    names: value("--stack")?.split(","),
  });
  if (report.some((item) => item.status !== "passed")) process.exitCode = 1;
}
