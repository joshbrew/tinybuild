import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(".." + path.sep))
  );
};
const manifestPath = (cwd) => path.join(cwd, ".tinybuild/outputs.json");
async function manifest(cwd) {
  try {
    const data = JSON.parse(await fs.readFile(manifestPath(cwd), "utf8"));
    if (data.version !== 1 || !Array.isArray(data.files))
      throw new Error("Invalid generated-output manifest");
    return data.files;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function save(cwd, files) {
  const filename = manifestPath(cwd);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = filename + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(
      temporary,
      JSON.stringify({ version: 1, files }, null, 2) + "\n",
    );
    await fs.rename(temporary, filename);
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
async function checked(cwd, entry, canonicalRoot, verify = true) {
  if (
    typeof entry.path !== "string" ||
    path.isAbsolute(entry.path) ||
    !/^[a-f0-9]{64}$/.test(entry.hash || "")
  )
    throw new Error("Invalid generated-output manifest entry");
  const filename = path.resolve(cwd, entry.path);
  if (
    !inside(cwd, filename) ||
    filename === cwd ||
    inside(path.join(cwd, ".tinybuild"), filename)
  )
    throw new Error("Unsafe generated-output manifest path: " + entry.path);
  if (!verify) return filename;
  try {
    if (
      !inside(
        canonicalRoot || (await fs.realpath(cwd)),
        await fs.realpath(filename),
      )
    )
      throw new Error("Generated output escapes project: " + entry.path);
    if (!(await fs.lstat(filename)).isFile())
      throw new Error("Generated output is not a regular file: " + entry.path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return filename;
}
export async function recordOutputs(
  files,
  { cwd = process.cwd(), kind = "build" } = {},
) {
  cwd = path.resolve(cwd);
  const previous = await manifest(cwd);
  const entries = new Map(previous.map((item) => [item.path, item]));
  const filenames = [
    ...new Set(files.map((file) => path.resolve(cwd, file))),
  ].filter((file) => inside(cwd, file));
  const canonicalRoot = filenames.length ? await fs.realpath(cwd) : cwd;
  let changed = false;
  for (let offset = 0; offset < filenames.length; offset += 16) {
    const batch = await Promise.all(
      filenames.slice(offset, offset + 16).map(async (filename) => {
        const entry = {
          path: path.relative(cwd, filename).split(path.sep).join("/"),
          kind,
          hash: digest(await fs.readFile(filename)),
        };
        await checked(cwd, entry, canonicalRoot);
        return entry;
      }),
    );
    for (const entry of batch) {
      const old = entries.get(entry.path);
      if (!old || old.hash !== entry.hash || old.kind !== entry.kind)
        changed = true;
      entries.set(entry.path, entry);
    }
  }
  if (changed) await save(cwd, [...entries.values()]);
}
export async function cleanGenerated({
  cwd = process.cwd(),
  dryRun = false,
  kind,
  keep = [],
} = {}) {
  cwd = path.resolve(cwd);
  const entries = await manifest(cwd);
  const canonicalRoot = entries.length ? await fs.realpath(cwd) : cwd;
  // Always validate manifest paths; only inspect files this cleanup can remove.
  const paths = await Promise.all(
    entries.map((entry) =>
      checked(cwd, entry, canonicalRoot, !kind || entry.kind === kind),
    ),
  );
  const kept = new Set(keep.map((filename) => path.resolve(cwd, filename)));
  const removed = [],
    preserved = [],
    remaining = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i],
      filename = paths[i];
    if ((kind && entry.kind !== kind) || kept.has(filename)) {
      remaining.push(entry);
      continue;
    }
    let data;
    try {
      data = await fs.readFile(filename);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (digest(data) !== entry.hash) {
      preserved.push(entry.path);
      remaining.push(entry);
      continue;
    }
    removed.push(entry.path);
    if (!dryRun) await fs.unlink(filename);
  }
  if (!dryRun && remaining.length !== entries.length)
    await save(cwd, remaining);
  return { dryRun, removed, preserved };
}
export async function copyAssets(
  definitions = [],
  { cwd = process.cwd() } = {},
) {
  cwd = path.resolve(cwd);
  const plan = [],
    inputs = [];
  for (const item of definitions) {
    const source = path.resolve(cwd, item.from),
      target = path.resolve(cwd, item.to);
    if (
      !inside(cwd, target) ||
      target === cwd ||
      inside(path.join(cwd, ".tinybuild"), target)
    )
      throw new Error(
        "Copy destination must be a project output path: " + item.to,
      );
    const directory = (await fs.stat(source)).isDirectory();
    if (directory && inside(source, target))
      throw new Error("Copy destination cannot be inside its source");
    const realSource = directory
      ? await fs.realpath(source)
      : await fs.realpath(path.dirname(source));
    async function walk(from, to, ancestors = new Set()) {
      const real = await fs.realpath(from);
      if (!inside(realSource, real))
        throw new Error("Copied symlink escapes source: " + from);
      if (ancestors.has(real))
        throw new Error("Circular copied symlink: " + from);
      const stat = await fs.stat(from);
      if (stat.isDirectory()) {
        for (const name of await fs.readdir(from)) {
          if ([".git", "node_modules"].includes(name)) continue;
          await walk(
            path.join(from, name),
            path.join(to, name),
            new Set(ancestors).add(real),
          );
        }
        return;
      }
      if (!stat.isFile()) return;
      if (
        /^\.env(?:\.|$)/.test(path.basename(from)) ||
        /\.(pem|key|pfx|jks)$/i.test(from)
      )
        throw new Error("Private file cannot be copied: " + from);
      if (
        item.filter &&
        !item.filter(path.relative(source, from).split(path.sep).join("/"))
      )
        return;
      if (from === to)
        throw new Error("Copy source and destination must differ");
      plan.push({ from, to });
      inputs.push(from);
    }
    await walk(source, target);
  }
  // Validate every destination before changing any files, including existing links.
  if (new Set(plan.map((item) => item.to)).size !== plan.length)
    throw new Error(
      "Copy destinations overlap; each output must have one source",
    );
  for (const { to } of plan) {
    let parent = to;
    while (true) {
      try {
        if (!inside(await fs.realpath(cwd), await fs.realpath(parent)))
          throw new Error("Copy destination escapes project: " + to);
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        parent = path.dirname(parent);
      }
    }
  }
  await cleanGenerated({
    cwd,
    kind: "copy",
    keep: plan.map((item) => item.to),
  });
  for (const { from, to } of plan) {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }
  if (plan.length)
    await recordOutputs(
      plan.map((item) => item.to),
      { cwd, kind: "copy" },
    );
  const relative = (file) => path.relative(cwd, file).split(path.sep).join("/");
  return {
    files: plan.map((item) => item.to),
    metafile: {
      inputs: Object.fromEntries(
        await Promise.all(
          inputs.map(async (file) => [
            relative(file),
            { bytes: (await fs.stat(file)).size, imports: [] },
          ]),
        ),
      ),
      outputs: Object.fromEntries(
        await Promise.all(
          plan.map(async ({ to }) => [
            relative(to),
            {
              bytes: (await fs.stat(to)).size,
              imports: [],
              exports: [],
              inputs: {},
            },
          ]),
        ),
      ),
    },
  };
}
