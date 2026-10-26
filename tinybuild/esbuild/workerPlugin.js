import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import esbuild from "esbuild";

export function workerPlugin({
  blobWorkers = true,
  bundler = {},
  workerType,
  ancestry = [],
} = {}) {
  return {
    name: "workerloader",
    setup(builder) {
      const cwd = builder.initialOptions.absWorkingDir || process.cwd();
      const childOutputs = new Map();
      const childInputs = new Map();
      const pendingFiles = new Map();
      builder.onStart(() => {
        childOutputs.clear();
        childInputs.clear();
        pendingFiles.clear();
      });
      builder.onEnd(async (result) => {
        if (result.errors.length) return;
        for (const [filename, contents] of pendingFiles) {
          if (builder.initialOptions.write === false) {
            result.outputFiles.push({
              path: filename,
              contents,
              hash: createHash("sha256").update(contents).digest("hex"),
              get text() {
                return new TextDecoder().decode(contents);
              },
            });
          } else {
            await fs.mkdir(path.dirname(filename), { recursive: true });
            await fs.writeFile(filename, contents);
          }
        }
        if (result.metafile) {
          Object.assign(
            result.metafile.outputs,
            Object.fromEntries(childOutputs),
          );
          Object.assign(
            result.metafile.inputs,
            Object.fromEntries(childInputs),
          );
        }
      });
      // Recognize the worker suffix even when the JS/TS extension is omitted.
      const filter = /(?:^|[/.])worker\.[cm]?[jt]sx?$|\.worker$/i;
      builder.onResolve({ filter }, async (args) => {
        if (
          args.kind === "entry-point" ||
          args.namespace === "tinybuild-worker" ||
          args.pluginData?.tinybuildWorker
        )
          return;
        const resolved = await builder.resolve(args.path, {
          resolveDir: args.resolveDir,
          kind: args.kind,
          pluginData: { tinybuildWorker: true },
        });
        if (resolved.errors.length) return { errors: resolved.errors };
        if (resolved.external) return { path: resolved.path, external: true };
        // Shared helper modules may import the current worker's own exports.
        // Inside that worker, this is an ordinary module back-reference, not
        // another worker to compile. Direct self imports and A -> B -> A worker
        // cycles still go through the nested-worker cycle check below.
        if (
          resolved.path === ancestry.at(-1) &&
          args.importer !== resolved.path
        )
          return resolved;
        return { path: resolved.path, namespace: "tinybuild-worker" };
      });
      builder.onLoad(
        { filter: /.*/, namespace: "tinybuild-worker" },
        async (args) => {
          if (ancestry.includes(args.path))
            throw new Error(
              "Circular nested worker import: " +
                [...ancestry, args.path]
                  .map((file) => path.basename(file))
                  .join(" -> "),
            );
          if (ancestry.length >= 32)
            throw new Error("Nested worker depth exceeds 32");
          const options = builder.initialOptions;
          const node = (bundler.platform || options.platform) === "node";
          if (node && blobWorkers)
            throw new Error("Node workers require blobWorkers:false");
          const directory = path.resolve(
            cwd,
            options.outdir || path.dirname(options.outfile || "dist/index.js"),
          );
          const hash = createHash("sha256")
            .update(path.relative(cwd, args.path).split(path.sep).join("/"))
            .digest("hex")
            .slice(0, 10);
          if (workerType && !["module", "classic"].includes(workerType))
            throw new Error("workerType must be module or classic");
          const workerFormat =
            bundler.format ||
            (node || workerType === "module" ? "esm" : "iife");
          if (workerType === "classic" && workerFormat === "esm")
            throw new Error("Classic workers cannot use ESM output");
          const extension = node
            ? workerFormat === "esm"
              ? ".mjs"
              : ".cjs"
            : ".js";
          const filename =
            path.basename(args.path).replace(/\.[cm]?[jt]sx?$/i, "") +
            "-" +
            hash +
            extension;
          const settings = {
            absWorkingDir: cwd,
            bundle: true,
            platform: node ? "node" : "browser",
            format: workerFormat,
            define: options.define,
            target: options.target,
            logLevel: options.logLevel,
            external: options.external,
            alias: options.alias,
            nodePaths: options.nodePaths,
            conditions: options.conditions,
            mainFields: options.mainFields,
            resolveExtensions: options.resolveExtensions,
            tsconfig: options.tsconfig,
            tsconfigRaw: options.tsconfigRaw,
            minifyWhitespace: true,
            plugins: options.plugins
              .filter(
                (plugin) =>
                  !["workerloader", "tinybuild-globals"].includes(plugin.name),
              )
              .concat(
                workerPlugin({
                  blobWorkers,
                  bundler,
                  workerType,
                  ancestry: [...ancestry, args.path],
                }),
              ),
            ...bundler,
            // A file named flow.worker (or flow.Worker) contains JavaScript
            // unless the caller explicitly supplies another loader for it.
            loader: /^\.worker$/i.test(path.extname(args.path))
              ? {
                  [path.extname(args.path)]: "js",
                  ...(bundler.loader || options.loader),
                }
              : bundler.loader || options.loader,
            entryPoints: [args.path],
            outdir: undefined,
            outfile: path.join(directory, filename),
            metafile: true,
            write: false,
          };
          // Child builds own a plugin set; parent output and entry options cannot leak in.
          const result = await esbuild.build(settings);
          const watchFiles = Object.keys(result.metafile.inputs).map((file) =>
            path.resolve(cwd, file),
          );
          for (const [filename, info] of Object.entries(result.metafile.inputs))
            childInputs.set(filename, info);
          if (blobWorkers) {
            if (
              result.outputFiles.some(
                (file) =>
                  !file.path.endsWith(".js") && !file.path.endsWith(".map"),
              )
            )
              throw new Error(
                "Blob workers with emitted assets require blobWorkers:false",
              );
            const javascript = result.outputFiles.find((file) =>
              file.path.endsWith(".js"),
            );
            return {
              contents:
                "const source=" +
                JSON.stringify(javascript.text) +
                ';let url=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));let active=0;export default url;export function revokeWorkerURL(){if(url){URL.revokeObjectURL(url);url=undefined;}}export function createWorker(options={}){if(!url)url=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));const worker=new Worker(url,{' +
                (workerFormat === "esm" ? 'type:"module",' : "") +
                "...options});active++;const terminate=worker.terminate.bind(worker);let stopped=false;worker.terminate=()=>{if(stopped)return;stopped=true;try{return terminate();}finally{if(--active===0)revokeWorkerURL();}};return worker;}",
              loader: "js",
              watchFiles,
            };
          }
          for (const file of result.outputFiles) {
            pendingFiles.set(file.path, file.contents);
          }
          for (const [filename, info] of Object.entries(
            result.metafile.outputs,
          ))
            childOutputs.set(filename, info);
          const publicURL =
            (options.publicPath || "").replace(/\/$/, "") + "/" + filename;
          const contents = node
            ? options.format === "cjs"
              ? 'import path from "node:path"; export default path.join(__dirname, ' +
                JSON.stringify(filename) +
                ");"
              : 'import {fileURLToPath} from "node:url"; export default fileURLToPath(new URL(' +
                JSON.stringify("./" + filename) +
                ", import.meta.url));"
            : options.publicPath
              ? "export default " + JSON.stringify(publicURL) + ";"
              : options.format === "esm"
                ? "export default new URL(" +
                  JSON.stringify("./" + filename) +
                  ", import.meta.url).href;"
                : 'const base = typeof document !== "undefined" ? (document.currentScript?.src || document.baseURI) : location.href; export default new URL(' +
                  JSON.stringify("./" + filename) +
                  ", base).href;";
          const helper = node
            ? 'import {Worker as TinybuildWorker} from "node:worker_threads";export function createWorker(options={}){return new TinybuildWorker(workerURL,options);}export function revokeWorkerURL(){}'
            : "export function createWorker(options={}){return new Worker(workerURL,{" +
              (workerFormat === "esm" ? 'type:"module",' : "") +
              "...options});}export function revokeWorkerURL(){}";
          return {
            contents:
              contents.replace("export default ", "const workerURL = ") +
              "export default workerURL;" +
              helper,
            loader: "js",
            resolveDir: cwd,
            watchFiles,
          };
        },
      );
    },
  };
}
