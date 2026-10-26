import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
const execute = promisify(execFile);
export async function compileSidecar({
  cwd = process.cwd(),
  target = process.env.TAURI_ENV_TARGET_TRIPLE,
  run = execute,
} = {}) {
  if (!target) {
    const { stdout } = await run("rustc", ["-vV"], { cwd });
    target = /^host: (\S+)$/m.exec(stdout)?.[1];
  }
  if (!target || !/^[a-zA-Z0-9_-]+$/.test(target))
    throw Error("Cannot determine the Rust target triple");
  const output = path.join(
    cwd,
    "src-tauri/binaries",
    `tinybuild-math-backend-${target}${target.includes("windows") ? ".exe" : ""}`,
  );
  await fs.mkdir(path.dirname(output), { recursive: true });
  // This tiny dependency-free backend can be replaced with an already-built
  // Python/Node/Go executable. Its runtime must be included in that executable.
  await run(
    "rustc",
    [
      "--edition=2021",
      "--target",
      target,
      "-O",
      path.join(cwd, "backend.rs"),
      "-o",
      output,
    ],
    { cwd },
  );
  return output;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  console.log(await compileSidecar());
