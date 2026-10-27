import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const execute = promisify(execFile);

// TypeScript 7's supported CLI emits declarations without its former JS API.
// Compile into a disposable folder so write:false and failed builds stay safe.
export async function nativeDeclarations(config, compiler, cwd) {
  const pkgFile = createRequire(compiler).resolve("typescript/package.json");
  const pkg = JSON.parse(await fs.readFile(pkgFile, "utf8"));
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.tsc;
  if (!bin)
    throw new Error(
      "The installed TypeScript package has no tsc command. Reinstall TypeScript.",
    );
  const cli = path.resolve(path.dirname(pkgFile), bin);
  const run = async (args) => {
    try {
      return (
        await execute(process.execPath, [cli, ...args, "--pretty", "false"], {
          cwd,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        })
      ).stdout;
    } catch (error) {
      throw new Error((error.stdout || error.stderr || error.message).trim());
    }
  };
  let filename;
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    const candidate = path.resolve(dir, config.tsconfig || "tsconfig.json");
    if (
      await fs.access(candidate).then(
        () => true,
        () => false,
      )
    ) {
      filename = candidate;
      break;
    }
    if (path.dirname(dir) === dir) break;
  }
  const project = filename ? ["--project", filename] : [];
  const resolved = filename
    ? JSON.parse(await run([...project, "--showConfig"]))
    : {};
  const options = resolved.compilerOptions || {};
  const configDir = filename ? path.dirname(filename) : cwd;
  const defaults = {
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    allowJs: true,
    skipLibCheck: true,
  };
  const args = [...project];
  if (!filename) {
    const entries = config.entryPoints || ["index.js"];
    args.push(
      ...(typeof entries === "string"
        ? [entries]
        : Array.isArray(entries)
          ? entries
          : Object.values(entries)
      ).map((entry) =>
        path.resolve(cwd, typeof entry === "string" ? entry : entry.in),
      ),
    );
  }
  for (const [key, value] of Object.entries(defaults))
    if (options[key] === undefined) args.push("--" + key, String(value));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "tinybuild-types-"));
  try {
    const typeRoot = path.join(temp, "types");
    await fs.mkdir(path.join(typeRoot, "tinybuild-css"), { recursive: true });
    await fs.writeFile(
      path.join(typeRoot, "tinybuild-css/index.d.ts"),
      'declare module "*.css" {}\n',
    );
    const roots = (options.typeRoots || []).map((root) =>
      path.resolve(configDir, root),
    );
    for (let dir = configDir; ; dir = path.dirname(dir)) {
      if (!options.typeRoots) roots.push(path.join(dir, "node_modules/@types"));
      // Named packages such as @webgpu/types live outside @types.
      roots.push(path.join(dir, "node_modules"));
      if (path.dirname(dir) === dir) break;
    }
    args.push("--typeRoots", [...roots, typeRoot].join(","));
    args.push("--types", [...(options.types || []), "tinybuild-css"].join(","));
    const emitted = path.join(temp, "output");
    args.push(
      "--declaration",
      "true",
      "--emitDeclarationOnly",
      "true",
      "--noEmit",
      "false",
      "--noEmitOnError",
      "true",
      "--incremental",
      "false",
      "--outDir",
      emitted,
      "--declarationDir",
      emitted,
    );
    await run(args);
    const destination = path.resolve(
      cwd,
      config.outdir || path.dirname(config.outfile || "dist/index"),
    );
    const outputs = [];
    async function collect(directory) {
      const entries = await fs
        .readdir(directory, {
          withFileTypes: true,
        })
        .catch((error) => {
          if (error.code === "ENOENT" && directory === emitted) return [];
          throw error;
        });
      const collected = [];
      for (let offset = 0; offset < entries.length; offset += 16) {
        const batch = await Promise.all(
          entries.slice(offset, offset + 16).map(async (entry) => {
            const source = path.join(directory, entry.name);
            if (entry.isDirectory()) {
              return collect(source);
            }
            const target = path.join(
              destination,
              path.relative(emitted, source),
            );
            let text = await fs.readFile(source, "utf8");
            if (entry.name.endsWith(".map")) {
              const map = JSON.parse(text);
              const remote = (value) =>
                /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(value || "");
              if (!remote(map.sourceRoot)) {
                map.sources = map.sources.map((item) =>
                  remote(item)
                    ? item
                    : path
                        .relative(
                          path.dirname(target),
                          path.resolve(
                            path.dirname(source),
                            map.sourceRoot || "",
                            item,
                          ),
                        )
                        .split(path.sep)
                        .join("/"),
                );
                map.sourceRoot = "";
              }
              text = JSON.stringify(map);
            }
            return [{ path: target, text }];
          }),
        );
        collected.push(...batch.flat());
      }
      return collected;
    }
    outputs.push(...(await collect(emitted)));
    if (config.write !== false) {
      for (const directory of new Set(
        outputs.map((output) => path.dirname(output.path)),
      ))
        await fs.mkdir(directory, { recursive: true });
      for (let offset = 0; offset < outputs.length; offset += 16)
        await Promise.all(
          outputs
            .slice(offset, offset + 16)
            .map((output) => fs.writeFile(output.path, output.text)),
        );
    }
    return { outputs };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
