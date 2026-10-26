import { builtinModules } from "node:module";
import path from "node:path";
import fs from "node:fs/promises";
import { runPackageCommand } from "../process.js";

const builtins = new Set(
  builtinModules.flatMap((name) => [name, "node:" + name]),
);
const pending = new Map();
const projectQueues = new Map();
export function packageName(specifier) {
  if (builtins.has(specifier) || /^[./\\]|^[a-z]+:/i.test(specifier))
    return null;
  const name = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(name) ? name : null;
}
export function createInstallerPlugin({
  enabled = true,
  install = runPackageCommand,
} = {}) {
  return {
    name: "installer",
    setup(build) {
      const cwd = build.initialOptions.absWorkingDir || process.cwd();
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (
          !enabled ||
          args.namespace !== "file" ||
          args.pluginData?.tinybuildInstaller
        )
          return;
        // Package managers already resolve transitive/optional dependencies.
        // Installing every guarded require in a package would pull in bindings
        // for other operating systems and architectures.
        if (args.importer?.split(/[\\/]/).includes("node_modules")) return;
        const name = packageName(args.path);
        if (!name) return;
        const key = cwd + "::" + name;
        if (pending.has(key)) {
          await pending.get(key);
          return build.resolve(args.path, {
            resolveDir: args.resolveDir || cwd,
            kind: args.kind,
            pluginData: { tinybuildInstaller: true },
          });
        }
        const resolved = await build.resolve(args.path, {
          resolveDir: args.resolveDir || cwd,
          kind: args.kind,
          pluginData: { tinybuildInstaller: true },
        });
        if (!resolved.errors.length) return resolved;
        // Do not try to repair a missing exported subpath in an installed package.
        const parts = name.split("/");
        let cursor = args.resolveDir || cwd;
        while (true) {
          try {
            await fs.access(
              path.join(cursor, "node_modules", ...parts, "package.json"),
            );
            return;
          } catch {}
          const parent = path.dirname(cursor);
          if (parent === cursor) break;
          cursor = parent;
        }
        if (!pending.has(key)) {
          const task = (projectQueues.get(cwd) || Promise.resolve())
            .catch(() => {})
            .then(async () => {
              let manager = "npm";
              try {
                manager =
                  JSON.parse(
                    await fs.readFile(path.join(cwd, "package.json"), "utf8"),
                  ).packageManager?.split("@")[0] || "npm";
              } catch {}
              if (!["npm", "pnpm", "yarn"].includes(manager))
                throw new Error("Unsupported package manager: " + manager);
              await install([manager === "npm" ? "install" : "add", name], {
                cwd,
                manager,
              });
            })
            .finally(() => {
              pending.delete(key);
              if (projectQueues.get(cwd) === task) projectQueues.delete(cwd);
            });
          pending.set(key, task);
          projectQueues.set(cwd, task);
        }
        await pending.get(key);
        return build.resolve(args.path, {
          resolveDir: args.resolveDir || cwd,
          kind: args.kind,
          pluginData: { tinybuildInstaller: true },
        });
      });
    },
  };
}
export const installerPlugin = createInstallerPlugin();
