import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { starterRecipes } from "../tinybuild/starters.js";
const root = fileURLToPath(new URL("../", import.meta.url));
export async function syncStarters({ check = false } = {}) {
  const stale = [];
  const version = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  ).version;
  for (const recipe of starterRecipes) {
    const files = new Map();
    async function collect(directory, relative = "") {
      for (const entry of await fs.readdir(directory, {
        withFileTypes: true,
      })) {
        if (
          [
            "node_modules",
            "dist",
            "electron",
            "src-tauri",
            "android",
            "ios",
            "mobile_dist",
            ".tinybuild",
          ].includes(entry.name) ||
          /(?:\.log|\.bak|\.tgz|package-lock\.json)$/.test(entry.name)
        )
          continue;
        const file = path.join(relative, entry.name);
        if (entry.isDirectory())
          await collect(path.join(directory, entry.name), file);
        else if (entry.isFile())
          files.set(file, await fs.readFile(path.join(directory, entry.name)));
      }
    }
    await collect(path.join(root, "examples", recipe.name));
    const pkg = JSON.parse(files.get("package.json").toString());
    pkg.name = "tinybuild-app";
    pkg.scripts = {
      start: "tinybuild dev",
      build: "tinybuild build",
      check: "tinybuild check",
      ...Object.fromEntries(
        Object.entries(pkg.scripts || {}).map(([name, command]) => [
          name,
          command.replaceAll("node ../../tinybuild/bin/global.js", "tinybuild"),
        ]),
      ),
      ...(["default_ts", "worker_types"].includes(recipe.name)
        ? { typecheck: "tsc -p tsconfig.json" }
        : {}),
    };
    pkg.devDependencies = {
      ...pkg.devDependencies,
      tinybuild: "^" + version,
      ...(["default_ts", "worker_types", "library"].includes(recipe.name)
        ? { typescript: ">=5.6 <8" }
        : {}),
    };
    files.set("package.json", Buffer.from(JSON.stringify(pkg, null, 2) + "\n"));
    const readme = (
      files.get("README.md")?.toString() ||
      "# " + recipe.name + "\n\n" + recipe.description + "\n"
    )
      .replaceAll("node ../../tinybuild/bin/global.js", "npx tinybuild")
      .replace(/`tinybuild /g, "`npx tinybuild ")
      .replaceAll("../../tinybuild/", "node_modules/tinybuild/tinybuild/");
    const title = /^# (.+)/.exec(readme)?.[1] || recipe.name;
    const finalCommand = ["library", "native_shells"].includes(recipe.name)
      ? "npm run build"
      : "npm start";
    const details = readme
      .replace(/^# [^\n]+\r?\n/, "")
      .replace(/```sh\r?\n([\s\S]*?)\r?\n```\s*/g, (block, commands) =>
        commands.trim() === finalCommand ? "" : block,
      )
      .trim();
    files.set(
      "README.md",
      Buffer.from(
        "# " +
          title +
          "\n\n## Run\n\n```sh\nnpm install\n" +
          finalCommand +
          "\n```\n\n" +
          (recipe.name === "library"
            ? "Builds finish and exit; this starter does not start a server.\n"
            : recipe.name === "native_shells"
              ? "Staging prepares native app folders without opening an SDK or server.\n"
              : "Follow the printed URL. Stop development with Ctrl+C.\n") +
          "\n## Try it\n\n" +
          details +
          "\n\nRun `npm run check` to verify the build when needed. The complete `tinybuild.config.js` explains all settings. [Agent guide](node_modules/tinybuild/tinybuild/docs/agents.md).\n",
      ),
    );
    for (const [file, content] of files) {
      const dest = path.join(root, "tinybuild", "recipes", recipe.name, file);
      const previous = await fs.readFile(dest).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      if (!previous?.equals(content)) {
        stale.push(recipe.name + "/" + file);
        if (!check) {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.writeFile(dest, content);
        }
      }
    }
  }
  return stale;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const stale = await syncStarters({ check: process.argv.includes("--check") });
  if (process.argv.includes("--check") && stale.length) {
    console.error(
      "Refresh shipped starters with npm run sync:starters:\n" +
        stale.join("\n"),
    );
    process.exitCode = 1;
  } else console.log("Shipped starters are synchronized.");
}
