// Optional real native packaging check. No container or VM setup is performed.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../tinybuild/config.js";
import { packager } from "../tinybuild/packager.js";
const cwd = fileURLToPath(
  new URL("../examples/native_profiles/", import.meta.url),
);
const dryRun = process.argv.includes("--dry-run");
const tauri = process.argv.includes("--tauri");
const config = await loadConfig("tinybuild.config.js", cwd);
const app = await packager(
  {
    ...config,
    build: true,
    server: false,
    electron: tauri
      ? false
      : {
          action: "make",
          makers: [
            {
              name: "@electron-forge/maker-zip",
              platforms: [process.platform],
            },
          ],
        },
    tauri: tauri ? { action: "build", noBundle: true } : false,
    mobile: false,
  },
  { cwd, native: { dryRun } },
);
try {
  if (dryRun) console.log(JSON.stringify(app.native.invocations, null, 2));
  else if (tauri) {
    const targetRoot = path.resolve(
      cwd,
      process.env.CARGO_TARGET_DIR || "src-tauri/target",
    );
    const executable = path.join(
      targetRoot,
      "release",
      "tinybuild-app" + (process.platform === "win32" ? ".exe" : ""),
    );
    const handle = await fs.open(executable);
    try {
      const header = Buffer.alloc(4);
      await handle.read(header, 0, 4, 0);
      const signatures = [
        "4d5a",
        "7f454c46",
        "cffaedfe",
        "feedfacf",
        "cafebabe",
        "bebafeca",
      ];
      if (!signatures.some((value) => header.toString("hex").startsWith(value)))
        throw new Error("Unrecognized Tauri executable: " + executable);
    } finally {
      await handle.close();
    }
    console.log("Tauri executable verified: " + executable);
  } else {
    const directory = path.join(cwd, "electron/out/make");
    const archives = (await fs.readdir(directory, { recursive: true })).filter(
      (filename) => filename.endsWith(".zip"),
    );
    if (!archives.length)
      throw new Error("Native packaging produced no ZIP distribution");
    for (const archive of archives) {
      const file = await fs.open(path.join(directory, archive));
      try {
        const header = Buffer.alloc(4);
        await file.read(header, 0, 4, 0);
        if (!header.equals(Buffer.from([80, 75, 3, 4])))
          throw new Error("Invalid native archive: " + archive);
      } finally {
        await file.close();
      }
    }
    console.log("Native distributions verified: " + archives.join(", "));
  }
} finally {
  await app.close();
}
