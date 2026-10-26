import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { outputContext } from "./reporting.js";

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const { signal, ...settings } = options;
    if (signal?.aborted) {
      reject(new Error("Command aborted: " + command));
      return;
    }
    const child = spawn(command, args, {
      stdio: outputContext.getStore()?.machine ? ["inherit", 2, 2] : "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
      ...settings,
    });
    let force;
    const abort = () => {
      terminateChild(child).catch(reject);
      force = setTimeout(
        () => terminateChild(child, "SIGKILL").catch(() => {}),
        2000,
      );
      force.unref?.();
    };
    const cleanup = () => {
      clearTimeout(force);
      signal?.removeEventListener("abort", abort);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, exitSignal) => {
      cleanup();
      if (signal?.aborted) reject(new Error("Command aborted: " + command));
      else if (code === 0) resolve({ code, signal: exitSignal });
      else
        reject(new Error(command + " failed (" + (exitSignal || code) + ")"));
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function terminateChild(child, signal = "SIGTERM") {
  if (!child.pid || child.exitCode !== null || child.signalCode) {
    if (!child.pid) child.kill(signal);
    return;
  }
  if (process.platform === "win32") {
    await new Promise((resolve) =>
      execFile(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
        (error) => {
          if (error && child.exitCode === null) child.kill(signal);
          resolve();
        },
      ),
    );
  } else {
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  }
}
export async function runPackageCommand(
  args,
  { cwd = process.cwd(), manager = "npm", ...options } = {},
) {
  if (manager === "npm" || manager === "npx") {
    const candidates = [
      process.env.npm_execpath,
      path.join(
        path.dirname(process.execPath),
        "node_modules/npm/bin/npm-cli.js",
      ),
    ].filter(Boolean);
    const cli = candidates.find(
      (candidate) => existsSync(candidate) && candidate.endsWith("npm-cli.js"),
    );
    if (cli)
      return runCommand(
        process.execPath,
        [cli, ...(manager === "npx" ? ["exec", "--"] : []), ...args],
        { cwd, ...options },
      );
  }
  const executable = manager + (process.platform === "win32" ? ".cmd" : "");
  if (
    process.platform === "win32" &&
    args.some((value) => /[&|<>^%!"\r\n]/.test(value))
  )
    throw new Error("Unsafe argument for Windows package-manager shim");
  return runCommand(executable, args, {
    cwd,
    shell: process.platform === "win32",
    ...options,
  });
}
export function packageAvailable(name, cwd = process.cwd()) {
  try {
    createRequire(path.join(cwd, "package.json")).resolve(name);
    return true;
  } catch {}
  let directory = path.resolve(cwd);
  while (true) {
    if (existsSync(path.join(directory, "node_modules", name, "package.json")))
      return true;
    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}
