import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { packageAvailable } from "./process.js";
import { fileURLToPath } from "node:url";
import { version as esbuildVersion } from "esbuild";
import { previewConfig } from "./preview.js";
const runtimeRoot = fileURLToPath(new URL("../", import.meta.url));

// Deliberately select useful settings instead of dumping executable config,
// environment values, routes, headers, command arguments or application metadata.
export function doctorReport(
  config = {},
  { cwd = process.cwd(), ...options } = {},
) {
  const plan = previewConfig(config, { cwd });
  const tools = doctor(cwd, options);
  const pick = (value, keys) =>
    Object.fromEntries(
      keys
        .filter((key) => value?.[key] !== undefined)
        .map((key) => [key, value[key]]),
    );
  const project = {
    profile: plan.profile,
    outputs: plan.outputs.map((output) =>
      pick(output, [
        "target",
        "entries",
        "format",
        "platform",
        "outfile",
        "outdir",
        "gzip",
      ]),
    ),
    server:
      plan.server === false
        ? false
        : pick(plan.server, [
            "root",
            "host",
            "port",
            "protocol",
            "startpage",
            "hotreload",
            "delay",
            "hotreloadTransport",
          ]),
    tasks: plan.tasks,
    native: plan.native.map((target) =>
      pick(target, ["target", "action", "directory"]),
    ),
  };
  // Hide local user/project prefixes and URL credentials/query values in paths.
  const home = process.env.USERPROFILE || process.env.HOME;
  const paths = [
    [path.resolve(cwd), "<project>"],
    ...(home ? [[home, "<home>"]] : []),
  ];
  const redact = (value) => {
    if (typeof value === "string") {
      for (const [prefix, label] of paths)
        value = value
          .split(prefix)
          .join(label)
          .split(prefix.replaceAll("\\", "/"))
          .join(label);
      return value.replace(/https?:\/\/[^\s"'<>]+/gi, (text) => {
        try {
          const url = new URL(text);
          if (url.username) url.username = "redacted";
          if (url.password) url.password = "redacted";
          for (const key of new Set(url.searchParams.keys()))
            url.searchParams.set(key, "redacted");
          if (url.hash) url.hash = "redacted";
          return url.href;
        } catch {
          return "[redacted URL]";
        }
      });
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, redact(item)]),
      );
    return value;
  };
  return {
    ok:
      tools.every((check) => check.ok || check.optional) &&
      !plan.validation.errors.length,
    runtime: {
      tinybuild: JSON.parse(
        fs.readFileSync(path.join(runtimeRoot, "package.json"), "utf8"),
      ).version,
      node: process.version,
      esbuild: esbuildVersion,
      platform: options.platform || process.platform,
      arch: process.arch,
    },
    tools,
    project: redact(project),
    // Validation messages can contain user-supplied values; retain only locations.
    validation: {
      errors: plan.validation.errors.map(({ path }) => path),
      warnings: plan.validation.warnings.map(({ path }) => path),
    },
  };
}

export function doctor(
  cwd = process.cwd(),
  {
    target = "browser",
    run = spawnSync,
    env = process.env,
    platform = process.platform,
  } = {},
) {
  if (
    !["browser", "node", "electron", "tauri", "android", "ios"].includes(target)
  )
    throw new Error("Unknown doctor target: " + target);
  const checks = [
    {
      name: "Node >=22",
      ok: Number(process.versions.node.split(".")[0]) >= 22,
      detail: process.version,
      remedy: "Install Node.js 22 or newer.",
    },
  ];
  for (const name of ["esbuild", "chokidar", "ws", "typescript"])
    checks.push({
      name,
      ok: packageAvailable(name, cwd) || packageAvailable(name, runtimeRoot),
      optional: name === "typescript",
      remedy:
        "Install project dependencies; for declarations install TypeScript too.",
    });
  const command = (name, args, remedy, executable = name) => {
    const result = run(executable, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    });
    const item = { name, ok: result.status === 0, remedy };
    checks.push(item);
    return result;
  };
  if (target === "electron")
    checks.push({
      name: "electron",
      ok: packageAvailable("electron", cwd),
      remedy:
        "Install Electron in the app project before opening its native window.",
    });
  if (target === "tauri") {
    command(
      "rustc",
      ["--version"],
      "Install the Rust toolchain, then reopen your terminal.",
    );
    command(
      "cargo",
      ["--version"],
      "Install the Rust toolchain, then reopen your terminal.",
    );
    checks.push({
      name: "@tauri-apps/cli",
      ok: packageAvailable("@tauri-apps/cli", cwd),
      remedy:
        "Install @tauri-apps/cli in the app project. Also install your OS-specific Tauri build prerequisites.",
    });
  }
  if (target === "android") {
    const root = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
    checks.push({
      name: "Android SDK",
      ok: Boolean(root && fs.existsSync(root)),
      remedy: "Install the Android SDK and set ANDROID_HOME to its directory.",
    });
    command(
      "java",
      ["-version"],
      "Install the JDK required by your Android project and set JAVA_HOME.",
    );
    const executable = root
      ? path.join(
          root,
          "platform-tools",
          platform === "win32" ? "adb.exe" : "adb",
        )
      : "adb";
    const devices = command(
      "adb",
      ["devices", "-l"],
      "Install Android platform-tools; enable USB debugging and authorize this computer on the device.",
      executable,
    );
    const states = String(devices.stdout || "")
      .split(/\r?\n/)
      .slice(1)
      .filter((line) => line.trim());
    checks.push({
      name: "Android device",
      ok: states.some((line) => /^\S+\s+device\b/.test(line)),
      remedy: states.some((line) => /unauthorized/.test(line))
        ? "Accept the USB debugging prompt on your device, then run doctor again."
        : "Connect an authorized device or start an Android emulator.",
    });
  }
  if (target === "ios" || (target === "tauri" && platform === "darwin")) {
    checks.push({
      name: "macOS",
      ok: platform === "darwin",
      remedy:
        "Use a Mac for iOS builds, or an existing Mac through a remote preset.",
    });
    if (platform === "darwin") {
      command(
        "xcodebuild",
        ["-version"],
        "Install and select Xcode, then accept its license.",
      );
      if (target === "ios") {
        const result = command(
          "iOS simulator tools",
          ["simctl", "list", "devices", "available", "--json"],
          "Install an iOS simulator runtime in Xcode.",
          "xcrun",
        );
        let devices = [];
        try {
          devices = Object.values(
            JSON.parse(result.stdout || "{}").devices || {},
          ).flat();
        } catch {
          /* Report an unusable simulator inventory below. */
        }
        checks.push({
          name: "iOS simulator",
          ok:
            result.status === 0 &&
            devices.some((device) => device.isAvailable !== false),
          remedy:
            "Create an available iOS simulator in Xcode, then run doctor again.",
        });
      }
    }
  }
  return checks;
}
