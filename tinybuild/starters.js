import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeMissing } from "./create.js";

export const starterRecipes = [
  { name: "default", description: "Browser app with CSS and hot reload." },
  {
    name: "default_ts",
    description: "TypeScript browser app with a commented tsconfig.",
  },
  {
    name: "webworkers",
    description: "Browser app that runs work in a web worker.",
  },
  {
    name: "worker_types",
    description:
      "Typed worker imports with URL declarations and a worker factory.",
  },
  {
    name: "html_bundle",
    description: "Portable HTML with embedded worker and assets.",
  },
  {
    name: "library",
    description: "JavaScript library with multiple formats and declarations.",
  },
  {
    name: "server_workflow",
    description: "Development and production server, readiness and API routes.",
  },
  {
    name: "native_shells",
    description: "Electron, Tauri, Android and iOS staging without SDKs.",
  },
];

export async function scaffoldWorker(
  name,
  { cwd = process.cwd(), typescript, runtime = "browser", dryRun = false } = {},
) {
  if (typeof name !== "string" || !name.trim())
    throw new Error("Supply a worker name, such as src/flow.Worker");
  if (!["browser", "node"].includes(runtime))
    throw new Error("Worker runtime must be browser or node");
  if (typescript !== undefined && typeof typescript !== "boolean")
    throw new Error("typescript must be true or false");
  name = name.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = name.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[<>:"|?*\x00-\x1f]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw new Error("Use a relative worker path inside the project");
  const extension = /\.(js|ts)$/i.exec(name)?.[1].toLowerCase();
  if (/\.worker\./i.test(name) && !/\.worker\.(js|ts)$/i.test(name))
    throw new Error(
      "Generated workers use .worker.js or .worker.ts (either .worker or .Worker spelling)",
    );
  if (
    extension &&
    typescript !== undefined &&
    (extension === "ts") !== typescript
  )
    throw new Error("The filename extension and --typescript setting disagree");
  typescript ??= extension === "ts";
  let stem = extension ? name.slice(0, -3) : name;
  if (!/\.worker$/i.test(stem)) stem += ".worker";
  const relative = stem + (typescript ? ".ts" : ".js");
  const declaration = stem.replace(/\.([^.]*)$/, ".d.$1.ts");
  cwd = path.resolve(cwd);
  const entries = new Map();
  const source =
    runtime === "node"
      ? 'import { parentPort } from "node:worker_threads";\n\nconst port = parentPort;\nif (!port) throw new Error("Run this file as a Node worker");\nport.on("message", (value' +
        (typescript ? ": number" : "") +
        ") => {\n  port.postMessage(value * 2);\n});\n"
      : "// Send a number to this worker; it replies with twice that number.\nonmessage = ({ data }" +
        (typescript ? ": MessageEvent<number>" : "") +
        ") => {\n  postMessage(data * 2);\n};\n";
  entries.set(relative, source);
  if (typescript)
    entries.set(
      declaration,
      "// These types describe the URL and helpers returned by tinybuild's worker plugin.\n" +
        (runtime === "node"
          ? 'import type { Worker, WorkerOptions } from "node:worker_threads";\n'
          : "") +
        "declare const workerURL: string;\nexport default workerURL;\nexport declare function createWorker(options?: WorkerOptions): Worker;\nexport declare function revokeWorkerURL(): void;\n",
    );
  const inside = (root, filename) => {
    const child = path.relative(root, filename);
    return (
      child !== ".." &&
      !child.startsWith(".." + path.sep) &&
      !path.isAbsolute(child)
    );
  };
  // Check existing ancestors as well as the lexical path: a source folder may
  // be a link into another checkout, which must never receive generated files.
  const root = await fs.realpath(cwd).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return cwd;
  });
  let ancestor = path.dirname(path.resolve(cwd, relative));
  while (true) {
    try {
      if (!inside(root, await fs.realpath(ancestor)))
        throw new Error("Worker path escapes the project through a link");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (ancestor === cwd || ancestor === path.dirname(ancestor)) break;
      ancestor = path.dirname(ancestor);
    }
  }
  for (const candidate of [
    stem,
    ...[".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".mts", ".cts"].map(
      (ext) => stem + ext,
    ),
    declaration,
  ]) {
    try {
      await fs.lstat(path.join(cwd, candidate));
      throw new Error(
        "Worker already exists or would shadow an existing file: " + candidate,
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const specifier = "./" + stem;
  const usage =
    "import { createWorker } from " +
    JSON.stringify(specifier) +
    ";\nconst worker = createWorker();\n" +
    (runtime === "node"
      ? 'worker.once("message", value => { console.log(value); worker.terminate(); });\n'
      : "worker.onmessage = ({ data }) => { console.log(data); worker.terminate(); };\n") +
    "worker.postMessage(21);";
  if (!dryRun) {
    const written = [];
    try {
      for (const [file, contents] of entries) {
        const target = path.join(cwd, file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        // Recheck after creating directories, including a previously absent cwd.
        if (
          !inside(
            await fs.realpath(cwd),
            await fs.realpath(path.dirname(target)),
          )
        )
          throw new Error("Worker path escapes the project through a link");
        const handle = await fs.open(target, "wx");
        let complete = false;
        try {
          await handle.writeFile(contents);
          complete = true;
          written.push([target, contents]);
        } finally {
          await handle.close();
          // A failed write may leave an empty/partial file created by us.
          if (!complete) await fs.unlink(target);
        }
      }
    } catch (error) {
      for (const [target, contents] of written.reverse())
        if (
          await fs.readFile(target, "utf8").then(
            (value) => value === contents,
            () => false,
          )
        )
          await fs.unlink(target);
      throw error;
    }
  }
  return {
    cwd,
    runtime,
    typescript,
    dryRun,
    files: [...entries.keys()],
    specifier,
    usage,
    settings:
      runtime === "node"
        ? { bundleBrowser: false, bundleNode: true, blobWorkers: false }
        : {},
    next: [
      "The usage assumes an entry file in the project root; adjust the import for entries in other folders.",
      ...(typescript
        ? [
            'Enable "allowArbitraryExtensions": true in tsconfig and include the worker source when checking types.',
          ]
        : []),
      ...(runtime === "node"
        ? [
            "Use the returned settings in bundler; TypeScript Node apps also need @types/node.",
          ]
        : []),
    ],
  };
}
export function listStarters(search = "") {
  const terms = String(search).toLowerCase().split(/\s+/).filter(Boolean);
  return starterRecipes.filter((item) =>
    terms.every((term) =>
      (item.name + " " + item.description).toLowerCase().includes(term),
    ),
  );
}
export async function addAgentGuide(cwd) {
  return writeMissing(
    path.join(cwd, "TINYBUILD_AGENT.md"),
    await fs.readFile(new URL("./docs/agents.md", import.meta.url)),
  );
}
export async function initStarter(
  name,
  { cwd = process.cwd(), agentGuide = false } = {},
) {
  if (!starterRecipes.some((item) => item.name === name))
    throw new Error("Unknown starter: " + name + "; use tinybuild init --list");
  cwd = path.resolve(cwd);
  const source = fileURLToPath(
    new URL("./recipes/" + name + "/", import.meta.url),
  );
  // Refuse occupied destinations rather than mixing two unrelated applications.
  await fs.mkdir(cwd, { recursive: true });
  if (
    (await fs.readdir(cwd)).some(
      (entry) => ![".git", "AGENTS.md", "TINYBUILD_AGENT.md"].includes(entry),
    )
  )
    throw new Error(
      "Starter destination must be empty (existing agent instructions and .git are allowed)",
    );
  const written = [];
  async function copy(directory, relative = "") {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error("Starter contains a symbolic link");
      const file = path.join(relative, entry.name);
      if (entry.isDirectory())
        await copy(path.join(directory, entry.name), file);
      else if (
        entry.isFile() &&
        writeMissing(
          path.join(cwd, file),
          await fs.readFile(path.join(directory, entry.name)),
        )
      )
        written.push(file);
    }
  }
  await copy(source);
  if (agentGuide) await addAgentGuide(cwd);
  return {
    cwd,
    recipe: name,
    files: written,
    next: [
      "npm install",
      ["library", "native_shells"].includes(name)
        ? "npm run build"
        : "npm start",
    ],
    stop:
      name === "library"
        ? "Library builds finish and exit without starting a server."
        : name === "native_shells"
          ? "Staging prepares native app folders without launching an SDK or server."
          : "Ctrl+C stops development and its owned processes.",
  };
}
