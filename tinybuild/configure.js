import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { loadConfig, mergeConfig } from "./config.js";
import { assertConfig } from "./config-options.js";
import { previewConfig } from "./preview.js";
import { getTemplateSync } from "./templates/get.js";
import { optionReference } from "./option-reference.js";
const start = "// tinybuild:config:start";
const end = "// tinybuild:config:end";

export async function writeConfigEdits(
  filename,
  edits,
  { cwd = process.cwd(), dryRun = false, expectedSource } = {},
) {
  filename = path.resolve(cwd, filename);
  let source,
    exists = true;
  try {
    source = await fs.readFile(filename, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    exists = false;
    source = filename.endsWith(".cjs")
      ? "module.exports = {};\n"
      : getTemplateSync("tinybuild.config.js").toString();
  }
  if (
    expectedSource !== undefined &&
    (exists ? source : null) !== expectedSource
  )
    throw new Error("Config changed while editing; run tinybuild config again");
  let base = source;
  const first = base.indexOf(start),
    last = base.indexOf(end);
  if (first >= 0 || last >= 0) {
    if (
      first < 0 ||
      last < first ||
      base.indexOf(start, first + start.length) >= 0
    )
      throw new Error(
        "Managed config section is malformed; restore it or edit manually",
      );
    base =
      base.slice(0, first) +
      base.slice(last + end.length).replace(/^\r?\n/, "");
  }
  let reference;
  const cjs =
    filename.endsWith(".cjs") ||
    (!/\bexport\s+default\b/.test(base) && /module\.exports\s*=/.test(base));
  if (cjs) reference = "module.exports";
  else {
    reference = "__tinybuild_config__";
    if (
      !new RegExp(
        "// tinybuild:config:base\\s+const " + reference + "\\s*=",
      ).test(base)
    ) {
      if (base.includes(reference))
        throw new Error(
          "Reserved configurator identifier already exists; edit this config manually",
        );
      const matches = [...base.matchAll(/\bexport\s+default\s+/g)];
      let replacement;
      for (const match of matches) {
        const candidate =
          base.slice(0, match.index) +
          "\n// tinybuild:config:base\nconst " +
          reference +
          " = " +
          base.slice(match.index + match[0].length);
        try {
          await transform(candidate + "\nexport default " + reference + ";\n", {
            loader: "js",
            format: "esm",
            logLevel: "silent",
          });
          replacement = candidate;
          break;
        } catch {
          /* A match inside a string/comment leaves duplicate exports and is rejected by the parser. */
        }
      }
      if (!replacement)
        throw new Error(
          "Guided editing needs one top-level export default; edit this config manually",
        );
      base = replacement;
    }
  }
  // Repeated edits merge into the previous managed values, not the original defaults.
  let previous = {};
  if (first >= 0) {
    const json = /const edits = (\{[\s\S]*?\});\r?\n/.exec(
      source.slice(first, last),
    );
    if (!json) throw new Error("Managed config values are malformed");
    // Formatters can unquote keys or add trailing commas to this JS object.
    // Read only the managed literal in an isolated context; custom code stays above it.
    const values = runInNewContext("(" + json[1] + ")", Object.create(null), {
      timeout: 100,
      contextCodeGeneration: { strings: false, wasm: false },
    });
    previous = JSON.parse(
      JSON.stringify(values, (_key, value) => {
        if (
          ["function", "undefined", "symbol", "bigint"].includes(typeof value)
        )
          throw new Error(
            "Managed config values must be JSON data; move custom code above the managed section",
          );
        return value;
      }),
    );
  }
  const merged = mergeConfig(previous, edits);
  const jsonEdits = JSON.stringify(
    merged,
    (_key, value) => {
      if (["function", "symbol", "bigint"].includes(typeof value))
        throw new Error(
          "Guided edits must be JSON data; put callbacks and custom code in the main config object",
        );
      return value;
    },
    2,
  );
  const block = `${start}\n// Values selected with tinybuild config. Original comments and code remain above.\n{\nconst edits = ${jsonEdits};\nfor (const key of ['bundler','server']) {\n  if (key==='bundler' && edits.bundler?.outdir && !Object.hasOwn(edits.bundler,'outfile')) edits.bundler = {...edits.bundler,outfile:undefined};\n  if (edits[key] && !Array.isArray(edits[key]) && ${reference}[key] && !Array.isArray(${reference}[key])) edits[key] = {...${reference}[key],...edits[key]};\n}\nObject.assign(${reference}, edits);\n}\n${cjs ? "" : "export default " + reference + ";\n"}${end}\n`;
  const result = base.trimEnd() + "\n\n" + block;
  await transform(result, { loader: "js", format: cjs ? "cjs" : "esm" });
  if (dryRun) return { filename, source: result, backup: undefined };
  // Refuse to overwrite edits made while the prompts were open.
  if (exists && (await fs.readFile(filename, "utf8")) !== source)
    throw new Error("Config changed while editing; run tinybuild config again");
  const backup = exists
    ? filename + "." + Date.now() + "." + randomUUID().slice(0, 8) + ".bak"
    : undefined;
  if (backup) await fs.writeFile(backup, source, { flag: "wx" });
  const temporary = filename + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temporary, result, { flag: "wx" });
    await fs.rename(temporary, filename);
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return { filename, backup, source: result };
}

export async function configure({
  cwd = process.cwd(),
  filename,
  edits,
  yes = false,
  dryRun = false,
  question,
  log = console.log,
} = {}) {
  if (!filename) {
    for (const name of [
      "tinybuild.config.js",
      "tinybuild.config.mjs",
      "tinybuild.config.cjs",
    ]) {
      try {
        await fs.access(path.join(cwd, name));
        filename = name;
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  filename ||= "tinybuild.config.js";
  let expectedSource = null;
  try {
    expectedSource = await fs.readFile(path.resolve(cwd, filename), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let config = {};
  try {
    await fs.access(path.resolve(cwd, filename));
    config = await loadConfig(filename, cwd, true);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let reader;
  const suppliedQuestion = question;
  if (!edits) {
    if (!question && !process.stdin.isTTY)
      throw new Error(
        "Interactive config needs a terminal. For scripts use tinybuild config --set <JSON> --yes [--dryRun]",
      );
    reader = question
      ? undefined
      : createInterface({ input: process.stdin, output: process.stdout });
    question ||= (text) => reader.question(text);
    try {
      log(
        [
          "Choose a starting point (Enter keeps your current setup):",
          "  current     Keep this project's settings",
          "  browser     Web page with live reload",
          "  portable    One HTML file with its workers and assets inside",
          "  production  Compressed web files ready to serve",
          "  server      Serve existing files without bundling",
          "  library     Build JavaScript exports for other projects",
          "  node        Build a Node.js script or backend",
          "  electron / tauri  Desktop app with live reload",
          "  android / ios     Mobile app with live reload",
        ].join("\n"),
      );
      const recipe =
        (await question("Starting point [current]: ")).trim() || "current";
      if (
        ![
          "current",
          "browser",
          "portable",
          "production",
          "server",
          "library",
          "node",
          "electron",
          "tauri",
          "android",
          "ios",
        ].includes(recipe)
      )
        throw new Error("Unknown starting point: " + recipe);
      if (Array.isArray(config.bundler))
        throw new Error(
          "This config has multiple pipelines; use --set JSON to select precise changes or edit the annotated file",
        );
      const current = config.bundler || {};
      const building =
        recipe !== "server" &&
        (recipe !== "current" || config.bundler !== false);
      const serving =
        !["library", "node"].includes(recipe) &&
        (recipe !== "current" || config.server !== false);
      if (building)
        log(
          optionReference("bundler.entryPoints")[0]?.description ||
            "Choose the file where the app starts.",
        );
      const entry = !building
        ? ""
        : (
            await question(
              "Entry file [" + (current.entryPoints?.[0] || "index.js") + "]: ",
            )
          ).trim();
      const output =
        building || serving
          ? (
              await question(
                !building
                  ? "Static folder [" +
                      (config.server?.root ||
                        (recipe === "server" ? "public" : ".")) +
                      "]: "
                  : "Output directory [" + (current.outdir || "dist") + "]: ",
              )
            ).trim()
          : "";
      const port = serving
        ? (
            await question(
              "Web server port [" + (config.server?.port ?? 8080) + "]: ",
            )
          ).trim()
        : "";
      const reloadDefault =
        !["production", "server"].includes(recipe) &&
        config.server?.hotreload !== false;
      const reload = serving
        ? (
            await question(
              "Hot reload? " + (reloadDefault ? "[Y/n]" : "[y/N]") + ": ",
            )
          )
            .trim()
            .toLowerCase()
        : "";
      if (reload && !["y", "yes", "n", "no"].includes(reload))
        throw new Error("Hot reload expects yes or no");
      edits = {
        bundler: building
          ? {
              ...(entry ? { entryPoints: [entry] } : {}),
              ...(output ? { outdir: output, outfile: undefined } : {}),
            }
          : false,
        server: serving
          ? {
              ...(!building && output ? { root: output } : {}),
              ...(port ? { port: Number(port) } : {}),
              hotreload: reload ? !["n", "no"].includes(reload) : reloadDefault,
            }
          : false,
      };
      if (recipe !== "current" && building)
        Object.assign(edits.bundler, {
          bundleBrowser: !["library", "node"].includes(recipe),
          bundleESM: recipe === "library",
          bundleCommonJS: recipe === "library",
          bundleNode: recipe === "node",
          bundleHTML: ["portable", "production"].includes(recipe),
        });
      if (recipe === "production") {
        edits.production = true;
        Object.assign(edits.bundler, {
          minify: true,
          sourcemap: false,
          bundleGzip: true,
        });
        Object.assign(edits.server, {
          root:
            output ||
            current.outdir ||
            path.dirname(current.outfile || "dist/index"),
          startpage: "index.html",
          hotreload: false,
        });
        edits.electron = edits.tauri = edits.mobile = false;
      }
      if (recipe === "server") {
        edits.bundler = false;
        Object.assign(edits.server, {
          root: output || config.server?.root || "public",
          hotreload: false,
        });
        edits.electron = edits.tauri = edits.mobile = false;
      }
      if (["library", "node"].includes(recipe)) edits.server = false;
      if (["electron", "tauri"].includes(recipe)) {
        edits.electron =
          recipe === "electron"
            ? { action: "open", liveReload: true, devtools: true }
            : false;
        edits.tauri =
          recipe === "tauri" ? { action: "dev", liveReload: true } : false;
        edits.mobile = false;
      }
      if (["android", "ios"].includes(recipe)) {
        const connection =
          (
            await question(
              "Connection [" +
                (recipe === "android" ? "usb" : "simulator") +
                "]: ",
            )
          ).trim() || (recipe === "android" ? "usb" : "simulator");
        const device = (
          await question("Device id (blank lets Capacitor choose): ")
        ).trim();
        edits.mobile = {
          [recipe]: {
            action: "run",
            liveReload: true,
            connection,
            ...(device ? { target: device } : {}),
          },
        };
      }
    } finally {
      reader?.close();
      if (!suppliedQuestion) question = undefined;
    }
  }
  if (!edits || typeof edits !== "object" || Array.isArray(edits))
    throw new Error("Config edits must be a JSON object");
  const effective = mergeConfig(config, edits);
  // JSON cannot express undefined; outdir supersedes the starter outfile.
  if (
    edits.bundler?.outdir &&
    effective.bundler &&
    !Array.isArray(effective.bundler)
  )
    effective.bundler.outfile = undefined;
  assertConfig(effective, { onWarning: log });
  const plan = previewConfig(effective, { cwd });
  const selected = (edits, values) => {
    if (
      !edits ||
      !values ||
      typeof edits !== "object" ||
      typeof values !== "object" ||
      Array.isArray(edits)
    )
      return values;
    return Object.fromEntries(
      Object.keys(edits).map((key) => [key, selected(edits[key], values[key])]),
    );
  };
  log(
    "Settings to save:\n" +
      JSON.stringify(selected(edits, plan.config), null, 2),
  );
  log(
    "Builds: " +
      (plan.outputs
        .map(
          (output) => output.target + " → " + (output.outfile || output.outdir),
        )
        .join(", ") || "none"),
  );
  log(
    plan.server
      ? "Web server: " +
          plan.server.protocol +
          "://" +
          plan.server.host +
          ":" +
          plan.server.port +
          (plan.server.port === 0 ? " (automatic port)" : "") +
          "; files from " +
          plan.server.root
      : "Web server: off",
  );
  if (plan.native.length)
    log(
      "Native: " +
        plan.native
          .map((target) => target.target + " (" + target.action + ")")
          .join(", "),
    );
  log("Use tinybuild preview for the full resolved plan.");
  if (!yes && !dryRun) {
    if (!question && !process.stdin.isTTY)
      throw new Error("Use --yes to save these edits, or --dryRun to preview");
    const confirmReader = question
      ? undefined
      : createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await (question
        ? question("Save config (a backup will be created)? [y/N]: ")
        : confirmReader.question(
            "Save config (a backup will be created)? [y/N]: ",
          ));
      if (!/^y(?:es)?$/i.test(answer.trim())) return { cancelled: true };
    } finally {
      confirmReader?.close();
    }
  }
  const result = await writeConfigEdits(filename, edits, {
    cwd,
    dryRun,
    expectedSource,
  });
  log(
    dryRun
      ? "Config preview complete; no files written."
      : "Saved " +
          result.filename +
          (result.backup ? " (backup: " + result.backup + ")" : ""),
  );
  return result;
}
