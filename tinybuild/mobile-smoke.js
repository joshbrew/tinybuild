import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as pause } from "node:timers/promises";
const execute = promisify(execFile);
const appID = /^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/;
// An opt-in check for an already-built APK or simulator .app; never creates a VM.
export async function smokeMobile({
  platform,
  id,
  artifact,
  device,
  activity,
  dryRun = false,
  hostPlatform = process.platform,
  sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT,
  timeout = 120000,
  signal,
  run = execute,
} = {}) {
  if (!["android", "ios"].includes(platform))
    throw new Error("Mobile smoke platform must be android or ios");
  if (!appID.test(id || ""))
    throw new Error("Mobile smoke requires a reverse-domain app id");
  if (!artifact || !device)
    throw new Error("Mobile smoke requires an artifact and an explicit device");
  if (activity && !/^[\w.$/]+$/.test(activity))
    throw new Error("Invalid Android activity");
  if (platform === "ios" && hostPlatform !== "darwin" && !dryRun)
    throw new Error("iOS simulator smoke checks require macOS");
  const file = path.resolve(artifact);
  const commands = [];
  if (platform === "android") {
    if (!file.endsWith(".apk"))
      throw new Error("Android smoke checks require an APK");
    const adb = sdk
      ? path.join(
          sdk,
          "platform-tools",
          "adb" + (hostPlatform === "win32" ? ".exe" : ""),
        )
      : "adb";
    const prefix = ["-s", device];
    commands.push(
      [adb, [...prefix, "install", "-r", file]],
      [
        adb,
        [
          ...prefix,
          "shell",
          ...(activity
            ? [
                "am",
                "start",
                "-W",
                "-n",
                activity.includes("$")
                  ? "'" + id + "/" + activity + "'"
                  : id + "/" + activity,
              ]
            : [
                "monkey",
                "-p",
                id,
                "-c",
                "android.intent.category.LAUNCHER",
                "1",
              ]),
        ],
      ],
      [adb, [...prefix, "shell", "pidof", id]],
    );
  } else {
    if (!file.endsWith(".app"))
      throw new Error("iOS simulator smoke checks require a simulator .app");
    commands.push(
      ["xcrun", ["simctl", "bootstatus", device, "-b"]],
      ["xcrun", ["simctl", "install", device, file]],
      [
        "xcrun",
        ["simctl", "launch", "--terminate-running-process", device, id],
      ],
    );
  }
  if (dryRun) return { platform, id, device, commands, dryRun: true };
  await fs.access(file);
  let result;
  for (const [command, args] of commands)
    result = await run(command, args, {
      encoding: "utf8",
      timeout,
      signal,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  if (
    !(platform === "android" ? /\b\d+\b/ : /:\s*\d+\b/).test(
      result.stdout || "",
    )
  )
    throw new Error("App did not report a running process: " + id);
  return {
    platform,
    id,
    device,
    commands,
    dryRun: false,
    pid: result.stdout.trim(),
  };
}

// Opt-in SDK checks on a developer-selected test app/device. Permission changes
// are restored, and callers can assert their own UI at each lifecycle checkpoint.
export async function checkMobileLifecycle({
  permissions = [],
  relaunches = 1,
  reconnectPort,
  disconnectDelay = 1000,
  backgrounds = 0,
  backgroundDelay = 1000,
  verify = async () => {},
  run = execute,
  ...options
} = {}) {
  if (
    !Array.isArray(permissions) ||
    permissions.some((name) => !/^android\.permission\.[A-Z_]+$/.test(name))
  )
    throw new Error(
      "Permissions must be explicit Android runtime permission names",
    );
  if (permissions.length && options.platform !== "android")
    throw new Error("Permission mutation checks currently require Android");
  if (!Number.isInteger(relaunches) || relaunches < 0 || relaunches > 20)
    throw new Error("relaunches must be 0 to 20");
  if (!Number.isInteger(backgrounds) || backgrounds < 0 || backgrounds > 20)
    throw new Error("backgrounds must be 0 to 20");
  if (backgrounds && options.platform !== "android")
    throw new Error("Background/resume checks currently require Android");
  if (
    !Number.isFinite(backgroundDelay) ||
    backgroundDelay < 0 ||
    backgroundDelay > 60000
  )
    throw new Error("backgroundDelay must be 0 to 60000 milliseconds");
  if (
    reconnectPort !== undefined &&
    (options.platform !== "android" ||
      !Number.isInteger(reconnectPort) ||
      reconnectPort < 1 ||
      reconnectPort > 65535)
  )
    throw new Error(
      "reconnectPort must be an Android reverse port from 1 to 65535",
    );
  if (typeof verify !== "function")
    throw new Error("verify must be a checkpoint function");
  if (
    !Number.isFinite(disconnectDelay) ||
    disconnectDelay < 0 ||
    disconnectDelay > 60000
  )
    throw new Error("disconnectDelay must be 0 to 60000 milliseconds");
  const initial = await smokeMobile({ ...options, dryRun: true });
  const adb = initial.commands[0][0];
  const prefix = ["-s", options.device];
  const commands = [...initial.commands];
  const checkpoints = [];
  const settings = {
    encoding: "utf8",
    timeout: options.timeout || 120000,
    signal: options.signal,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  };
  const perform = async (command, args, cleanup = false) => {
    commands.push([command, args]);
    if (options.dryRun) return { stdout: "" };
    return run(
      command,
      args,
      cleanup ? { ...settings, signal: undefined, timeout: 15000 } : settings,
    );
  };
  const checkpoint = async (detail) => {
    checkpoints.push(detail);
    if (!options.dryRun) await verify(detail);
  };
  const launch = async (cleanup = false) => {
    const invocation = initial.commands[options.platform === "android" ? 1 : 2];
    let result = await perform(invocation[0], invocation[1], cleanup);
    if (options.platform === "android")
      result = await perform(
        adb,
        [...prefix, "shell", "pidof", options.id],
        cleanup,
      );
    if (
      !options.dryRun &&
      !(
        options.platform === "android" ? /^\s*\d+(?:\s+\d+)*\s*$/ : /:\s*\d+\b/
      ).test(result.stdout || "")
    )
      throw new Error("App did not restart: " + options.id);
  };
  const permission = async (name, grant, cleanup = false) => {
    await perform(
      adb,
      [...prefix, "shell", "pm", grant ? "grant" : "revoke", options.id, name],
      cleanup,
    );
    if (!options.dryRun) {
      const current = await perform(
        adb,
        [...prefix, "shell", "dumpsys", "package", options.id],
        cleanup,
      );
      const state = new RegExp(
        name.replaceAll(".", "\\.") + ":\\s*granted=(true|false)\\b",
      ).exec(current.stdout || "");
      if (!state || (state[1] === "true") !== grant)
        throw new Error(
          "Runtime permission did not change as requested: " + name,
        );
    }
  };
  const restore = [];
  let reverseChanged = false,
    previousReverse,
    backgrounded = false;
  try {
    if (!options.dryRun) await smokeMobile({ ...options, run });
    await checkpoint({ phase: "launched" });
    if (permissions.length) {
      const snapshot = await perform(adb, [
        ...prefix,
        "shell",
        "dumpsys",
        "package",
        options.id,
      ]);
      for (const name of [...new Set(permissions)]) {
        const escaped = name.replaceAll(".", "\\.");
        const state = new RegExp(escaped + ":\\s*granted=(true|false)\\b").exec(
          snapshot.stdout || "",
        );
        if (!options.dryRun && !state)
          throw new Error(
            "Could not determine original runtime permission: " + name,
          );
        if (!options.dryRun)
          restore.push({ name, granted: state[1] === "true" });
        await permission(name, false);
        await launch();
        await checkpoint({
          phase: "permission",
          permission: name,
          granted: false,
        });
        await permission(name, true);
        await launch();
        await checkpoint({
          phase: "permission",
          permission: name,
          granted: true,
        });
      }
    }
    for (let index = 0; index < backgrounds; index++) {
      await perform(adb, [
        ...prefix,
        "shell",
        "input",
        "keyevent",
        "KEYCODE_HOME",
      ]);
      backgrounded = true;
      await checkpoint({ phase: "backgrounded", iteration: index + 1 });
      if (!options.dryRun)
        await pause(backgroundDelay, undefined, { signal: options.signal });
      await launch();
      backgrounded = false;
      await checkpoint({ phase: "resumed", iteration: index + 1 });
    }
    for (let index = 0; index < relaunches; index++) {
      if (options.platform === "android")
        await perform(adb, [
          ...prefix,
          "shell",
          "am",
          "force-stop",
          options.id,
        ]);
      else
        await perform("xcrun", [
          "simctl",
          "terminate",
          options.device,
          options.id,
        ]);
      await launch();
      await checkpoint({ phase: "relaunched", iteration: index + 1 });
    }
    if (reconnectPort !== undefined) {
      const local = "tcp:" + reconnectPort;
      const listing = await perform(adb, [...prefix, "reverse", "--list"]);
      previousReverse = (listing.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .find((parts) => parts[1] === local)?.[2];
      if (!options.dryRun && !previousReverse)
        throw new Error(
          "Start USB live reload first; no reverse mapping exists for " + local,
        );
      reverseChanged = true;
      await perform(adb, [...prefix, "reverse", "--remove", local]);
      await checkpoint({ phase: "disconnected" });
      if (!options.dryRun)
        await pause(disconnectDelay, undefined, { signal: options.signal });
      await perform(adb, [
        ...prefix,
        "reverse",
        local,
        previousReverse || local,
      ]);
      reverseChanged = false;
      await checkpoint({ phase: "reconnected" });
    }
  } finally {
    const errors = [];
    if (reverseChanged && previousReverse)
      try {
        await perform(
          adb,
          [...prefix, "reverse", "tcp:" + reconnectPort, previousReverse],
          true,
        );
      } catch (error) {
        errors.push(error);
      }
    for (const state of restore.reverse())
      try {
        await permission(state.name, state.granted, true);
      } catch (error) {
        errors.push(error);
      }
    if (backgrounded)
      try {
        await launch(true);
      } catch (error) {
        errors.push(error);
      }
    if (errors.length)
      throw new AggregateError(
        errors,
        "Mobile test cleanup failed; check the test app's permission/reverse settings",
      );
  }
  return {
    ...initial,
    dryRun: Boolean(options.dryRun),
    commands,
    checkpoints,
    checked: !options.dryRun,
  };
}
