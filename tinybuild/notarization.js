import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

export function macReleasePlan(filename) {
  filename = path.resolve(filename);
  const extension = path.extname(filename).toLowerCase();
  if (![".app", ".dmg", ".pkg"].includes(extension))
    throw new Error("macOS release checks need an .app, .dmg or .pkg");
  return [
    extension === ".pkg"
      ? ["pkgutil", ["--check-signature", filename]]
      : [
          "codesign",
          ["--verify", "--deep", "--strict", "--verbose=2", filename],
        ],
    ["xcrun", ["stapler", "validate", filename]],
    [
      "spctl",
      [
        "--assess",
        "--verbose=2",
        "--type",
        extension === ".app"
          ? "execute"
          : extension === ".pkg"
            ? "install"
            : "open",
        ...(extension === ".dmg"
          ? ["--context", "context:primary-signature"]
          : []),
        filename,
      ],
    ],
  ];
}

export async function verifyMacRelease(
  filename,
  { platform = process.platform, dryRun = false, signal, run = execute } = {},
) {
  const commands = macReleasePlan(filename);
  if (!dryRun && platform !== "darwin")
    throw new Error("macOS release verification requires a Mac");
  if (!dryRun) {
    await fs.access(path.resolve(filename));
    for (const [command, args] of commands)
      await run(command, args, { windowsHide: true, timeout: 60000, signal });
  }
  return { file: path.resolve(filename), commands, verified: !dryRun, dryRun };
}

export async function notarizeMac({
  archive,
  application,
  keychainProfile,
  platform = process.platform,
  dryRun = false,
  timeout = 600000,
  signal,
  run = execute,
} = {}) {
  if (typeof archive !== "string" || !/\.(?:zip|dmg|pkg)$/i.test(archive))
    throw new Error("Notarization needs a signed .zip, .dmg or .pkg archive");
  if (
    typeof keychainProfile !== "string" ||
    !keychainProfile ||
    /[\r\n\0]/.test(keychainProfile)
  )
    throw new Error("Choose a stored notarytool keychain profile");
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new Error("Notarization timeout must be positive");
  const file = path.resolve(application || archive);
  const checks = macReleasePlan(file);
  const commands = [
    [
      "xcrun",
      [
        "notarytool",
        "submit",
        path.resolve(archive),
        "--keychain-profile",
        keychainProfile,
        "--wait",
        "--output-format",
        "json",
      ],
    ],
    ["xcrun", ["stapler", "staple", file]],
    ...checks,
  ];
  if (dryRun) return { file, commands, dryRun: true, verified: false };
  if (platform !== "darwin")
    throw new Error("Notarization requires a Mac with Xcode tools");
  await fs.access(path.resolve(archive));
  await fs.access(file);
  const submitted = await run(commands[0][0], commands[0][1], {
    encoding: "utf8",
    timeout,
    signal,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(submitted.stdout);
  } catch {
    throw new Error("notarytool did not return a JSON submission result");
  }
  if (report.status !== "Accepted")
    throw new Error(
      "Notarization was not accepted: " +
        (report.status || "unknown status") +
        (report.id ? " (submission " + report.id + ")" : ""),
    );
  for (const [command, args] of commands.slice(1))
    await run(command, args, { timeout: 60000, signal, windowsHide: true });
  return {
    file,
    commands,
    dryRun: false,
    verified: true,
    submissionId: report.id,
  };
}
