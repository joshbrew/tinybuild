import fs from "node:fs/promises";
import path from "node:path";
import { parseEnv, promisify } from "node:util";
import { execFile } from "node:child_process";
const execute = promisify(execFile);

export function serverRoot(config = {}, cwd = config.cwd || process.cwd()) {
  return path.resolve(
    cwd,
    config.root ||
      config.staticRoots?.["/"] ||
      (config.production ? "dist" : "."),
  );
}

export function browserURL(url, page = true) {
  const result = new URL(page === true ? "/" : page, url);
  if (
    result.origin !== new URL(url).origin ||
    !["http:", "https:"].includes(result.protocol)
  )
    throw new Error("Browser page must be a path on this server");
  if (["0.0.0.0", "[::]"].includes(result.hostname))
    result.hostname = "localhost";
  return result.href;
}

export async function openBrowser(
  url,
  { platform = process.platform, run = execute } = {},
) {
  const checked = new URL(url);
  if (!["http:", "https:"].includes(checked.protocol))
    throw new Error("Browser URL must use HTTP(S)");
  const [command, args] =
    platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", checked.href]]
      : platform === "darwin"
        ? ["open", [checked.href]]
        : ["xdg-open", [checked.href]];
  await run(command, args, { windowsHide: true, timeout: 10000 });
  return checked.href;
}

export async function loadEnvironment(
  files,
  { cwd = process.cwd(), env = process.env } = {},
) {
  if (!Array.isArray(files)) files = [files];
  if (!files.length || files.some((file) => typeof file !== "string" || !file))
    throw new Error("envFile needs a filename or list of filenames");
  const values = {};
  // Read every file before changing the environment; a missing file applies nothing.
  for (const filename of files)
    Object.assign(
      values,
      parseEnv(await fs.readFile(path.resolve(cwd, filename), "utf8")),
    );
  for (const [key, value] of Object.entries(values))
    if (!Object.hasOwn(env, key)) env[key] = value;
  return {
    files: files.map((file) => path.resolve(cwd, file)),
    keys: Object.keys(values),
  };
}

export async function probeServer(
  url,
  { timeout = 5000, signal, request = fetch } = {},
) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("Status URL must use HTTP(S)");
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new Error("Status timeout must be positive");
  const start = performance.now();
  try {
    const response = await request(parsed, {
      signal: AbortSignal.any([
        AbortSignal.timeout(timeout),
        ...(signal ? [signal] : []),
      ]),
      redirect: "error",
    });
    // Status checks do not download arbitrary application bodies or expose secrets.
    await response.body?.cancel();
    return {
      url: parsed.href,
      ready: response.ok,
      status: response.status,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    return {
      url: parsed.href,
      ready: false,
      status: null,
      durationMs: Math.round(performance.now() - start),
      error: signal?.aborted
        ? "Status check cancelled"
        : error.name === "TimeoutError"
          ? "Status check timed out"
          : "Server could not be reached",
    };
  }
}

export function staticCacheControl(config, pathname, filename) {
  if (!config.production) return "no-store";
  const rules = config.cacheControl || {};
  const prefix = Object.keys(rules)
    .filter((key) => key.startsWith("/"))
    .sort((a, b) => b.length - a.length)
    .find(
      (key) =>
        pathname === key ||
        pathname.startsWith(key.endsWith("/") ? key : key + "/"),
    );
  return (
    rules[prefix] ??
    rules[path.extname(filename).toLowerCase()] ??
    rules["*"] ??
    "public, max-age=0, must-revalidate"
  );
}

export function validateServerTools(config = {}) {
  if (
    config.portRetries !== undefined &&
    (!Number.isInteger(config.portRetries) ||
      config.portRetries < 0 ||
      config.portRetries > 100)
  )
    throw new Error("portRetries must be an integer from 0 to 100");
  for (const key of ["responseTimeout", "requestTimeout", "shutdownTimeout"])
    if (
      config[key] !== undefined &&
      (!Number.isFinite(config[key]) || config[key] < 0)
    )
      throw new Error(key + " must be nonnegative");
  if (
    config.open !== undefined &&
    typeof config.open !== "boolean" &&
    (typeof config.open !== "string" || !config.open)
  )
    throw new Error("open must be true, false or a page path");
  if (config.open) browserURL("http://localhost", config.open);
  if (config.isReady !== undefined && typeof config.isReady !== "function")
    throw new Error("isReady must be a function");
  if (config.onRequest !== undefined && typeof config.onRequest !== "function")
    throw new Error("onRequest must be a function");
  if (config.cacheControl !== undefined) {
    if (
      !config.cacheControl ||
      typeof config.cacheControl !== "object" ||
      Array.isArray(config.cacheControl)
    )
      throw new Error(
        "cacheControl must map URL prefixes or file extensions to header values",
      );
    for (const [key, value] of Object.entries(config.cacheControl))
      if (
        !(key === "*" || key.startsWith("/") || /^\.[a-z0-9]+$/i.test(key)) ||
        typeof value !== "string" ||
        /[\r\n]/.test(value)
      )
        throw new Error("Invalid cacheControl rule: " + key);
  }
}
