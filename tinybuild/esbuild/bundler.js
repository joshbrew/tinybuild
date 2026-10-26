//const globalExternals = require('@fal-works/esbuild-plugin-global-externals');

//const cwd = process.cwd()
import esbuild from "esbuild";
import {
  streamingImportsPlugin,
  createStreamingImportsPlugin,
} from "./streamingImportsPlugin.js";
import { workerPlugin } from "./workerPlugin.js";
import { runtimeAssetsPlugin } from "./runtimeAssetsPlugin.js";
import { installerPlugin, createInstallerPlugin } from "./installerPlugin.js";
import { gzipOutputs } from "../compression.js";

import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import { nativeDeclarations } from "./nativeDeclarations.js";

export const defaultBundler = {
  bundleBrowser: false, //create plain js build? Can include globals and init scripts
  bundleESM: false, //create esm module js files
  bundleTypes: false, //create .d.ts files, the entry point must be a typescript file! (ts, tsx, etc)
  bundleNode: false, //create node platform plain js build, specify platform:'node' to do the rest of the files
  bundleIIFE: false, //create an iife build, this is compiled temporarily to create the types files and only saved with bundleIIFE:true
  bundleCommonJS: false, //cjs format outputted as .cjs
  bundleHTML: false, //wrap the first entry point file as a plain js script in a boilerplate html file, frontend scripts can be run standalone like a .exe!
  entryPoints: ["index.js"], //entry point file(s). These can include .js, .mjs, .ts, .jsx, .tsx, or other javascript files. Make sure your entry point is a ts file if you want to generate types
  outfile: "dist/index", //exit point file, will append .js as well as indicators like .esm.js, .node.js for other build flags
  //outdir:'dist'               //exit point files, define for multiple bundle files
  bundle: true,
  platform: "browser", //'node' //bundleNode will use 'node' mode by default
  minify: false, //https://esbuild.github.io/api/#minify
  sourcemap: false,
  plugins: [], // defaults are instantiated per build context
  includeDefaultPlugins: true, //if custom plugins pass do we want to still use the default plugins by default? true by default
  //plugins:[cache(defaultBundler.cachePluginSettings), dtsPlugin()],
  //external: ['node:fetch'], //node-fetch here by default excludes a lot of default libraries if we want to compile the same code for browser and node envs (e.g. checking if process exists)
  allowOverwrite: true,
  loader: {
    //just a bunch of path import resolvers, will supply urls if marked 'file', text if marked 'text', and dataurls (blobs) if marked 'dataurl'. 'copy' for copying without bundling, 'empty' for skipping a file format
    ".html": "text", //not always necessary but it doesn't hurt
    ".txt": "text",
    ".yaml": "text",
    ".toml": "text",
    ".xml": "text",
    ".xhtml": "text",
    ".md": "text",
    ".gitignore": "file",
    ".wasm": "file",
    ".png": "file",
    ".PNG": "file",
    ".jpg": "file",
    ".gif": "file",
    ".ico": "file",
    ".bmp": "file",
    ".svg": "file",
    ".webm": "file",
    ".mid": "file",
    ".midi": "file",
    ".woff": "file",
    ".woff2": "file",
    ".ttf": "file",
    ".otf": "file",
    ".eot": "file",
    ".fnt": "file",
    ".fon": "file",
    ".mp3": "file",
    ".wav": "file",
    ".wma": "file",
    ".aac": "file",
    ".m4a": "file",
    ".avi": "file",
    ".flac": "file",
    ".flv": "file",
    ".mov": "file",
    ".mp4": "file",
    ".mkv": "file",
    ".h264": "file",
    ".3gp": "file",
    ".doc": "file",
    ".docx": "file",
    ".pdf": "file",
    ".odt": "file",
    ".ods": "file",
    ".odp": "file",
    ".ppt": "file",
    ".pptx": "file",
    ".csv": "file",
    ".xls": "file",
    ".xlsx": "file",
    ".sql": "file",
    ".obj": "file",
    ".collada": "file",
    ".x3d": "file",
    ".fbx": "file", //3d stuff
    ".3ds": "file",
    ".flc": "file",
    ".swf": "file",
    ".step": "file",
    ".stl": "file",
    ".glsl": "text",
    ".hlsl": "text",
    ".wgsl": "text",
    ".spirv": "text",
    ".py": "file",
    ".cpy": "file",
    ".c": "file",
    ".cpp": "file",
    ".h": "file",
    ".hpp": "file",
    ".sh": "file",
    ".cs": "file",
    ".swift": "file",
    ".vb": "file", //code stuff
    ".bin": "file",
    ".cmd": "file",
    ".msi": "file",
    ".com": "file",
    ".jar": "file",
    ".class": "file",
    ".rss": "file",
    ".jsp": "file",
    ".cgi": "file",
    ".brd": "file",
    ".sch": "file",
    ".gbr": "file",
    ".gb": "file",
    ".gerb": "file",
    ".drl": "file", //pcb stuff
    ".exe": "file",
    ".dmg": "file",
    ".elf": "file",
    ".app": "file",
    ".ini": "file",
    ".epub": "file",
    ".csh": "file",
    ".rtf": "file",
    ".jsonld": "file",
    ".mpkg": "file",
    ".zip": "file",
    ".7z": "file",
    ".rar": "file",
    ".gz": "file",
    ".tar": "file",
    ".iso": "file",
    ".toast": "file",
    ".vcd": "file",
    ".vcf": "file",
    ".cer": "file",
    ".pem": "file",
    ".pfx": "file",
    ".key": "file",
    ".sys": "file",
    ".tmp": "file",
    ".edf": "file",
    ".bdf": "file",
    ".eeg": "file",
    ".vhdr": "file",
    ".vmrk": "file",
    ".set": "file",
    ".fdt": "file",
    ".nirs": "file",
    ".snirf": "file",
    ".tsv": "file", //bunch of biodata formats
    ".fif": "file",
    ".dir": "file",
    ".sqd": "file",
    ".cnt": "file",
    ".gdf": "file",
    ".egi": "file",
    ".mff": "file",
    ".nxe": "file",
    ".htps": "file",
    ".elc": "file",
    ".sfp": "file",
  },
  outputs: {
    //overwrites main config settings for specific use cases
    node: {
      // external:[] //externals for node environment builds
    },
    //commonjs:{}
    //browser:{}
    //esm:{}
    iife: {
      // external:[] //we only use the iife for types so it doesn't really matter if it bundles node, just note otherwise if you need iife for some obscure reason
    },
  },
  defaultConfig: true, //indicates this object is the default config
  //globalThis:null //'brainsatplay'
  //globals:{[this.entryPoints[0]]:['Graph']}
  //init:{[this.entryPoints[0]]:function(bundle) { console.log('prepackaged bundle script!', bundle); }.toString()}
  //refer to esbuild docs for more settings
};

const targetFlags = {
  browser: "bundleBrowser",
  esm: "bundleESM",
  node: "bundleNode",
  commonjs: "bundleCommonJS",
  iife: "bundleIIFE",
};
const customKeys = new Set([
  ...Object.values(targetFlags),
  "bundleTypes",
  "bundleHTML",
  "bundleGzip",
  "outputs",
  "globalThis",
  "globals",
  "init",
  "defaultConfig",
  "includeDefaultPlugins",
  "blobWorkers",
  "workerBundler",
  "workerType",
  "runtimeAssets",
  "modifyExtensions",
  "hotSwap",
  "hotswap",
  "hotReload",
  "autoInstall",
  "remoteImports",
  "input",
]);

function pluginsFor(config) {
  const defaults =
    config.includeDefaultPlugins === false
      ? []
      : [
          createStreamingImportsPlugin(config.remoteImports),
          workerPlugin({
            blobWorkers: config.blobWorkers ?? true,
            bundler: config.workerBundler,
            workerType: config.workerType,
          }),
          createInstallerPlugin({ enabled: config.autoInstall !== false }),
        ];
  const plugins = new Map(defaults.map((plugin) => [plugin.name, plugin]));
  if (config.runtimeAssets)
    plugins.set(
      "tinybuild-runtime-assets",
      runtimeAssetsPlugin(config.runtimeAssets),
    );
  for (const plugin of config.plugins || []) plugins.set(plugin.name, plugin);
  return [...plugins.values()];
}

function globalWrapper(config, options) {
  if (!config.globalThis && !config.globals && !config.init) return;
  const roots = Array.isArray(options.entryPoints)
    ? options.entryPoints
    : Object.entries(options.entryPoints || {}).map(([out, entry]) => ({
        in: entry,
        out,
      }));
  const mapping = new Map();
  options.entryPoints = roots.map((entry, index) => {
    const source = typeof entry === "string" ? entry : entry.in;
    const key = "tinybuild-entry-" + index;
    mapping.set(key, source);
    return {
      in: key,
      out:
        typeof entry === "object"
          ? entry.out
          : path.basename(source, path.extname(source)),
    };
  });
  options.plugins.push({
    name: "tinybuild-globals",
    setup(build) {
      build.onResolve({ filter: /^tinybuild-entry-/ }, (args) => ({
        path: args.path,
        namespace: "tinybuild-entry",
      }));
      build.onLoad({ filter: /.*/, namespace: "tinybuild-entry" }, (args) => {
        const source = mapping.get(args.path);
        const absolute = path
          .resolve(options.absWorkingDir, source)
          .split(path.sep)
          .join("/");
        let contents =
          "export * from " +
          JSON.stringify(absolute) +
          "; import * as bundle from " +
          JSON.stringify(absolute) +
          ";\n";
        if (config.globalThis)
          contents +=
            "globalThis[" +
            JSON.stringify(config.globalThis) +
            "] = Object.assign(globalThis[" +
            JSON.stringify(config.globalThis) +
            "] || {}, bundle);\n";
        for (const key of config.globals?.[source] || [])
          contents +=
            "globalThis[" +
            JSON.stringify(key) +
            "] = bundle[" +
            JSON.stringify(key) +
            "];\n";
        if (config.init?.[source])
          contents += "(" + config.init[source].toString() + ")(bundle);\n";
        return { contents, loader: "js", resolveDir: options.absWorkingDir };
      });
    },
  });
}

export function normalizeBuildOptions(
  input = {},
  target = "browser",
  alterPath = false,
) {
  const flag = targetFlags[target];
  const override =
    typeof input[flag] === "object"
      ? input[flag]
      : input.outputs?.[target] || {};
  const config = {
    ...defaultBundler,
    ...input,
    ...override,
    loader: { ...defaultBundler.loader, ...input.loader, ...override.loader },
    define: { ...input.define, ...override.define },
    plugins: override.plugins || input.plugins,
  };
  const options = Object.fromEntries(
    Object.entries(config).filter(
      ([key, value]) => !customKeys.has(key) && value !== undefined,
    ),
  );
  options.absWorkingDir = path.resolve(config.absWorkingDir || process.cwd());
  options.entryPoints = config.input || config.entryPoints;
  if (typeof options.entryPoints === "string")
    options.entryPoints = [options.entryPoints];
  options.plugins = pluginsFor(config);
  options.metafile = true;
  options.allowOverwrite = input.allowOverwrite ?? false;
  if (options.outdir) delete options.outfile;
  options.format =
    override.format ||
    input.format ||
    (target === "node" && input.outfile?.endsWith(".cjs")
      ? "cjs"
      : {
          browser: "iife",
          esm: "esm",
          node: "esm",
          commonjs: "cjs",
          iife: "iife",
        }[target]);
  if (target === "node") {
    options.platform = "node";
    // Node loads installed packages itself, including native database/Bluetooth
    // bindings. Explicit packages:"bundle" still opts into bundling packages.
    options.packages = override.packages || input.packages || "external";
    // Missing source entries should report a missing file, rather than being
    // mistaken for an external package just because they lack a ./ prefix.
    const localEntry = (entry) =>
      typeof entry === "string" &&
      !path.isAbsolute(entry) &&
      !/^[.\\/]/.test(entry) &&
      /\.[cm]?[jt]sx?$/.test(entry)
        ? "./" + entry
        : entry;
    if (Array.isArray(options.entryPoints))
      options.entryPoints = options.entryPoints.map((entry) =>
        typeof entry === "object"
          ? { ...entry, in: localEntry(entry.in) }
          : localEntry(entry),
      );
    else if (options.entryPoints)
      options.entryPoints = Object.fromEntries(
        Object.entries(options.entryPoints).map(([name, entry]) => [
          name,
          localEntry(entry),
        ]),
      );
  }
  if (options.outfile && config.modifyExtensions !== false) {
    const extension =
      options.format === "cjs"
        ? ".cjs"
        : options.outfile.endsWith(".mjs")
          ? ".mjs"
          : ".js";
    let stem = options.outfile.replace(/\.(?:[cm]?js)$/, "");
    if (alterPath && !["browser", "commonjs"].includes(target))
      stem += "." + target;
    options.outfile = stem + extension;
  } else if (options.outdir && alterPath && target !== "browser")
    options.outdir = path.join(
      options.outdir,
      target === "commonjs" ? "cjs" : target,
    );
  if (options.outdir && options.format === "cjs")
    options.outExtension = { ".js": ".cjs", ...options.outExtension };
  if (target === "browser") globalWrapper(config, options);
  return options;
}

export function buildPlan(configs = {}) {
  const inputs = Array.isArray(configs) ? configs : [configs];
  return inputs.map((input) => {
    input ||= {};
    if (input.bundleGzip !== undefined && typeof input.bundleGzip !== "boolean")
      throw new Error("bundleGzip must be true or false");
    if (input.bundleGzip && input.write === false)
      throw new Error("bundleGzip requires write:true");
    let targets = Object.keys(targetFlags).filter(
      (target) => input[targetFlags[target]],
    );
    if (!targets.length && !input.bundleTypes) targets = ["browser"];
    const alterPath = targets.length > 1 || inputs.length > 1;
    return {
      config: input,
      targets: targets.map((target) => ({
        target,
        options: normalizeBuildOptions(input, target, alterPath),
      })),
    };
  });
}

async function finishTarget(result, options, config, target) {
  if (config.bundleHTML && target === "browser") {
    if (options.write === false)
      throw new Error("bundleHTML requires write:true");
    // Build a separate portable variant: normal JS can keep file workers/assets.
    const inlineLoader = Object.fromEntries(
      Object.entries(options.loader || {}).map(([extension, loader]) => [
        extension,
        ["file", "copy"].includes(loader) ? "dataurl" : loader,
      ]),
    );
    const htmlOptions = normalizeBuildOptions(
      {
        ...config,
        loader: inlineLoader,
        blobWorkers: true,
        workerBundler: {
          ...config.workerBundler,
          format: "iife",
          sourcemap: false,
        },
      },
      "browser",
      false,
    );
    Object.assign(htmlOptions, {
      write: false,
      format: "iife",
      splitting: false,
      sourcemap: false,
      loader: inlineLoader,
    });
    const portable = await esbuild.build(htmlOptions);
    if (
      Object.values(portable.metafile.outputs).some((output) =>
        output.imports.some((item) => item.external),
      )
    )
      throw new Error(
        "Self-contained HTML cannot contain external module imports",
      );
    result.htmlFiles = [];
    for (const javascript of portable.outputFiles.filter((file) =>
      file.path.endsWith(".js"),
    )) {
      const css = portable.outputFiles.find(
        (file) => file.path === javascript.path.replace(/\.js$/, ".css"),
      );
      const filename = javascript.path.replace(/\.js$/, ".html");
      writeHTML(filename, javascript.text, css?.text || "");
      result.htmlFiles.push(filename);
    }
    result.html = result.htmlFiles[0];
  }
  if (config.bundleGzip) result.gzipFiles = await gzipOutputs(result, options);
  return result;
}

export async function bundle(configs = {}) {
  return Promise.all(
    buildPlan(configs).map(async (plan) => {
      const results = { config: plan.config };
      for (const { target, options } of plan.targets)
        results[target] = await finishTarget(
          await esbuild.build(options),
          options,
          plan.config,
          target,
        );
      if (plan.config.bundleTypes) results.ts = await bundleTypes(plan.config);
      return results;
    }),
  );
}

export async function createBuildContexts(configs = {}) {
  const plans = buildPlan(configs);
  const contexts = [];
  try {
    for (const plan of plans) {
      for (const target of plan.targets)
        contexts.push({
          ...target,
          config: plan.config,
          context: await esbuild.context(target.options),
        });
    }
  } catch (error) {
    await Promise.all(contexts.map((item) => item.context.dispose()));
    throw error;
  }
  return {
    contexts,
    async rebuild() {
      const results = plans.map((plan) => ({ config: plan.config }));
      for (const item of contexts) {
        const result = await item.context.rebuild();
        const index = plans.findIndex((plan) => plan.config === item.config);
        results[index][item.target] = await finishTarget(
          result,
          item.options,
          item.config,
          item.target,
        );
      }
      for (let index = 0; index < plans.length; index++)
        if (plans[index].config.bundleTypes)
          results[index].ts = await bundleTypes(plans[index].config);
      return results;
    },
    async dispose() {
      await Promise.all(contexts.map((item) => item.context.dispose()));
    },
  };
}

export function bundleHTML(fromJSPath, config = {}) {
  if (!fromJSPath)
    throw new Error("A JavaScript output is required for HTML bundling");
  const output = fromJSPath.replace(/\.[^.]+$/, ".html");
  const css = fromJSPath.replace(/\.[^.]+$/, ".css");
  writeHTML(
    output,
    fs.readFileSync(fromJSPath, "utf8"),
    fs.existsSync(css) ? fs.readFileSync(css, "utf8") : "",
  );
  return output;
}
function writeHTML(output, javascript, css) {
  const style = css
    ? "<style>" + css.replace(/<\/style/gi, "<\\/style") + "</style>"
    : "";
  const script = javascript.replace(/<\/script/gi, "<\\/script");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      style +
      "</head><body><script>" +
      script +
      "</script></body></html>",
  );
}

async function single(config, target, alterPath) {
  const options = normalizeBuildOptions(config, target, alterPath);
  return finishTarget(await esbuild.build(options), options, config, target);
}
export const bundleBrowser = (config) => single(config, "browser", false);
export const bundleESM = (config, alterPath = true) =>
  single(config, "esm", alterPath);
export const bundleNode = (config, alterPath = true) =>
  single(config, "node", alterPath);
export const bundleCommonJS = (config, alterPath = true) =>
  single(config, "commonjs", alterPath);

export async function bundleTypes(config = {}) {
  const cwd = path.resolve(config.absWorkingDir || process.cwd());
  const projectRequire = createRequire(path.join(cwd, "package.json"));
  let compiler;
  try {
    compiler = projectRequire.resolve("typescript");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    try {
      compiler = createRequire(import.meta.url).resolve("typescript");
    } catch (fallbackError) {
      if (fallbackError.code !== "MODULE_NOT_FOUND") throw fallbackError;
      throw new Error(
        'bundleTypes needs TypeScript. Run npm install --save-dev "typescript@>=5.6 <8" in ' +
          cwd,
      );
    }
  }
  const ts = projectRequire(compiler);
  const [major, minor] = String(ts.versionMajorMinor || "")
    .split(".")
    .map(Number);
  if (major === 7) return nativeDeclarations(config, compiler, cwd);
  if (
    !((major === 5 && minor >= 6) || major === 6) ||
    typeof ts.sys?.fileExists !== "function" ||
    typeof ts.findConfigFile !== "function" ||
    typeof ts.createProgram !== "function"
  )
    throw new Error(
      "bundleTypes supports TypeScript >=5.6 <8; found " +
        (ts.version || "an incompatible package") +
        '. Run npm install --save-dev "typescript@>=5.6 <8" in ' +
        cwd,
    );
  const filename = ts.findConfigFile(
    cwd,
    ts.sys.fileExists,
    config.tsconfig || "tsconfig.json",
  );
  let parsed = { options: {}, fileNames: [] };
  if (filename) {
    const read = ts.readConfigFile(filename, ts.sys.readFile);
    if (read.error)
      throw new Error(
        ts.flattenDiagnosticMessageText(read.error.messageText, "\n"),
      );
    parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      path.dirname(filename),
    );
    if (parsed.errors.length)
      throw new Error(
        parsed.errors
          .map((error) =>
            ts.flattenDiagnosticMessageText(error.messageText, "\n"),
          )
          .join("\n"),
      );
  }
  const entries = config.entryPoints || defaultBundler.entryPoints;
  const rootNames = parsed.fileNames.length
    ? parsed.fileNames
    : (Array.isArray(entries)
        ? entries
        : typeof entries === "string"
          ? [entries]
          : Object.values(entries)
      ).map((entry) =>
        path.resolve(cwd, typeof entry === "string" ? entry : entry.in),
      );
  const options = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    skipLibCheck: true,
    ...(Number(ts.versionMajorMinor.split(".")[0]) >= 6
      ? { ignoreDeprecations: "6.0" }
      : {}),
    ...parsed.options,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    noEmitOnError: true,
    outDir: path.resolve(
      cwd,
      config.outdir || path.dirname(config.outfile || "dist/index"),
    ),
    declarationDir: undefined,
    incremental: false,
  };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => cwd;
  // Resolve project-local type packages from the build project, even when
  // tinybuild is called by another workspace. CSS side effects are handled by
  // esbuild; provide their ambient declaration without writing user sources.
  const cssTypes = path.join(cwd, ".tinybuild-css-imports.d.ts");
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (file) =>
    path.resolve(file) === cssTypes
      ? 'declare module "*.css" {}\n'
      : readFile(file);
  host.fileExists = (file) =>
    path.resolve(file) === cssTypes || fileExists(file);
  const program = ts.createProgram({
    rootNames: [...rootNames, cssTypes],
    options,
    host,
  });
  const outputs = [];
  const emit = program.emit(undefined, (file, text) => {
    outputs.push({ path: file, text });
    if (config.write !== false) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  });
  const errors = ts
    .sortAndDeduplicateDiagnostics([
      ...ts.getPreEmitDiagnostics(program),
      ...emit.diagnostics,
    ])
    .filter((error) => error.category === ts.DiagnosticCategory.Error);
  if (errors.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(errors, {
        getCurrentDirectory: () => cwd,
        getCanonicalFileName: (file) => file,
        getNewLine: () => "\n",
      }),
    );
  return { outputs };
}
