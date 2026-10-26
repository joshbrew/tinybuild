import fs from "node:fs/promises";
import path from "node:path";
// Keep custom Rust sources outside the generated src-tauri folder.
// Do not rewrite unchanged files: frontend saves should not restart Rust.
export async function prepareShell(cwd) {
  for (const [from, to] of [
    ["Cargo.toml", "Cargo.toml"],
    ["main.rs", "src/main.rs"],
  ]) {
    const source = await fs.readFile(path.join(cwd, "native", from));
    const target = path.join(cwd, "src-tauri", to);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const previous = await fs.readFile(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (!previous?.equals(source)) await fs.writeFile(target, source);
  }
}
export function shellPlugin() {
  return {
    name: "example-tauri-sidecar",
    setup(build) {
      build.onStart(() =>
        prepareShell(build.initialOptions.absWorkingDir || process.cwd()),
      );
    },
  };
}
