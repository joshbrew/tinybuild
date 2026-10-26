import fs from "node:fs/promises";
import path from "node:path";
// Copy only changed shell sources. A web-only edit must not relaunch the backend.
export async function prepareShell(cwd) {
  await fs.mkdir(path.join(cwd, "electron"), { recursive: true });
  for (const name of [
    "app.cjs",
    "preload.cjs",
    "backend.cjs",
    "package.json",
  ]) {
    const source = await fs.readFile(path.join(cwd, "native", name));
    const target = path.join(cwd, "electron", name);
    const previous = await fs.readFile(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (!previous?.equals(source)) await fs.writeFile(target, source);
  }
}
export function shellPlugin() {
  return {
    name: "example-electron-sidecar",
    setup(build) {
      build.onStart(() =>
        prepareShell(build.initialOptions.absWorkingDir || process.cwd()),
      );
    },
  };
}
