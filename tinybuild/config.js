import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
export function mergeConfig(base = {}, override = {}) {
  const result = { ...base, ...override };
  for (const key of ["bundler", "server"]) {
    if (
      override[key] &&
      !Array.isArray(override[key]) &&
      base[key] &&
      !Array.isArray(base[key])
    )
      result[key] = { ...base[key], ...override[key] };
  }
  if (result.production) {
    result.server =
      result.server === false
        ? false
        : { ...result.server, hotreload: false, production: true };
    if (result.bundler)
      result.bundler = mapBundlers(result.bundler, (value) => ({
        ...value,
        autoInstall: false,
        remoteImports: { ...value.remoteImports, frozen: true },
      }));
  }
  if (result.frozen && result.bundler)
    result.bundler = mapBundlers(result.bundler, (value) => ({
      ...value,
      autoInstall: false,
      remoteImports: { ...value.remoteImports, frozen: true },
    }));
  return result;
}
function mapBundlers(value, transform) {
  return Array.isArray(value) ? value.map(transform) : transform(value);
}
export async function loadConfig(filename, cwd = process.cwd(), fresh = false) {
  const location = path.resolve(cwd, filename);
  const url = pathToFileURL(location);
  if (fresh) url.searchParams.set("t", Date.now() + "-" + Math.random());
  if (location.endsWith(".cjs")) {
    const require = createRequire(url);
    if (fresh) delete require.cache[require.resolve(location)];
    return require(location);
  }
  try {
    return (await import(url.href)).default;
  } catch (error) {
    // A .js config can use CommonJS exports even inside an ESM application.
    // Compile that config to an adjacent temporary .cjs so relative imports and
    // package resolution keep the same base directory.
    const commonJS =
      location.endsWith(".js") &&
      /(?:module|exports) is not defined/.test(error.message) &&
      /(?:^|[;\r\n])\s*(?:module\.exports|exports\.[\w$]+)\s*=/m.test(
        await fs.readFile(location, "utf8"),
      );
    if (commonJS) {
      const esbuild = await import("esbuild");
      const output = await esbuild.build({
        entryPoints: [location],
        bundle: true,
        packages: "external",
        platform: "node",
        format: "cjs",
        write: false,
        logLevel: "silent",
      });
      const temporary = path.join(
        path.dirname(location),
        ".tinybuild-config-" + randomUUID() + ".cjs",
      );
      const require = createRequire(pathToFileURL(temporary));
      try {
        await fs.writeFile(temporary, output.outputFiles[0].contents, {
          flag: "wx",
        });
        return require(temporary);
      } finally {
        delete require.cache[temporary];
        await fs.unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
    if (
      !location.endsWith(".js") ||
      !/Unexpected token|Cannot use import/.test(error.message)
    )
      throw error;
    const esbuild = await import("esbuild");
    const output = await esbuild.build({
      absWorkingDir: cwd,
      entryPoints: [location],
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      write: false,
    });
    const temporary = path.join(
      path.dirname(location),
      ".tinybuild-config-" + randomUUID() + ".mjs",
    );
    await fs.writeFile(temporary, output.outputFiles[0].contents);
    try {
      return (await import(pathToFileURL(temporary).href)).default;
    } finally {
      await fs.unlink(temporary);
    }
  }
}
