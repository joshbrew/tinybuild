import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { once } from "node:events";
export function terminalEnv(color) {
  const env = { ...process.env, FORCE_COLOR: color ? "1" : "0" };
  delete env.NO_COLOR;
  delete env.NODE_DISABLE_COLORS;
  return env;
}
export async function fixture(t, files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tinybuild-test-"));
  t?.after(async () => {
    if (
      path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith("tinybuild-test-")
    )
      throw new Error("Unsafe cleanup path");
    await fs.rm(root, { recursive: true, force: true });
  });
  for (const [filename, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, filename)), {
      recursive: true,
    });
    await fs.writeFile(path.join(root, filename), contents);
  }
  return root;
}
export async function request(server, pathname = "/", options = {}) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, ...options },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString(),
            bytes: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Model an editor's atomic save: Windows readers can briefly block replacement.
// Retry the rename itself; never delete the destination or hide lasting errors.
export async function renameForEditorSave(
  source,
  destination,
  { rename = fs.rename, platform = process.platform, wait = delay } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(source, destination);
    } catch (error) {
      if (
        platform !== "win32" ||
        !["EPERM", "EACCES", "EBUSY"].includes(error.code) ||
        attempt >= 8
      )
        throw error;
      await wait(Math.min(10 * 2 ** attempt, 200));
    }
  }
}
export async function until(predicate, timeout = 5000) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeout)
      throw new Error("Timed out waiting for behavior");
    await delay(20);
  }
}
export async function listening(server) {
  if (!server.listening) await once(server, "listening");
  return server;
}
