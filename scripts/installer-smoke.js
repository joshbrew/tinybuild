import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../tinybuild/process.js";

// NSIS only: other installer formats need their own explicit commands and checks.
// Use a disposable Windows runner/VM. Never install over an existing app folder.
export async function installNSIS({
  installer,
  directory,
  executable,
  platform = process.platform,
  run = runCommand,
  signal,
  dryRun = false,
} = {}) {
  if (platform !== "win32" && !dryRun)
    throw Error("NSIS installation checks require Windows");
  if (
    !path.isAbsolute(installer || "") ||
    !/\.exe$/i.test(installer) ||
    /["\r\n]/.test(installer) ||
    !path.isAbsolute(directory || "") ||
    /["\r\n]/.test(directory) ||
    path.parse(directory).root === path.resolve(directory)
  )
    throw Error(
      "Supply an absolute installer.exe and a new installation directory",
    );
  if (
    !executable ||
    path.basename(executable) !== executable ||
    !/\.exe$/i.test(executable)
  )
    throw Error("Supply the installed app's executable basename");
  installer = path.resolve(installer);
  directory = path.resolve(directory);
  const app = path.join(directory, executable),
    uninstaller = path.join(directory, "uninstall.exe");
  const commands = [
    [installer, ["/S", "/D=" + directory]],
    [uninstaller, ["/S", "_?=" + directory]],
  ];
  let closing;
  const close = () =>
    (closing ||= (async () => {
      if (dryRun) return;
      await fs.access(uninstaller);
      // _?= runs the uninstaller synchronously; NSIS leaves its own executable
      // behind in this mode. Its documented final cleanup is handled below.
      await run(...commands[1], {
        argv0: '"' + uninstaller + '"',
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: true,
        timeout: 120000,
      });
      try {
        await fs.access(app);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await fs.unlink(uninstaller).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        // Only remove an empty folder. Never recursively delete installer leftovers
        // or user data when the installer did not remove them itself.
        await fs.rmdir(directory).catch((error) => {
          if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
        });
        return;
      }
      throw Error(
        "Uninstaller left the application executable in place: " + app,
      );
    })());
  if (dryRun) return { directory, executable: app, commands, close, dryRun };
  await fs.access(installer);
  try {
    await fs.lstat(directory);
    throw Error("Installation directory already exists: " + directory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(directory), { recursive: true });
  try {
    // NSIS /D= and _?= must be last and unquoted, including paths with spaces.
    // No shell is involved; verbatim arguments preserve NSIS's own parsing.
    await run(...commands[0], {
      argv0: '"' + installer + '"',
      stdio: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: true,
      timeout: 120000,
      signal,
    });
    await fs.access(app);
    await fs.access(uninstaller);
  } catch (error) {
    try {
      await fs.access(uninstaller);
    } catch {
      throw error;
    }
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "Install failed and its cleanup failed",
      );
    }
    throw error;
  }
  return { directory, executable: app, commands, close, dryRun };
}
