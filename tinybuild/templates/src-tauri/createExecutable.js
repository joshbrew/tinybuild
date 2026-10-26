// Supply an already-built executable; this helper only stages a Tauri sidecar.
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
const execute = promisify(execFile);
export async function stageSidecar(
  input,
  { cwd = process.cwd(), run = execute } = {},
) {
  const { stdout } = await run("rustc", ["-vV"]);
  const triple = /^host: (\S+)$/m.exec(stdout)?.[1];
  if (!triple || !/^[a-zA-Z0-9_-]+$/.test(triple))
    throw new Error("Cannot determine Rust target triple");
  const extension = process.platform === "win32" ? ".exe" : "";
  const destination = path.join(
    cwd,
    "src-tauri/binaries/app-" + triple + extension,
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(path.resolve(cwd, input), destination);
  return destination;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.argv[2])
    throw new Error("Usage: node createExecutable.js <built executable>");
  console.log(await stageSidecar(process.argv[2]));
}
