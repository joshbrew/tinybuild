import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import create from "../tinybuild/create.js";
import { bundle } from "../tinybuild/esbuild/bundler.js";
import { transform } from "esbuild";
import { fixture } from "./helpers.js";

const template = await fs.readFile(
  new URL("../tinybuild/templates/tsconfig.json", import.meta.url),
  "utf8",
);
function options(cwd) {
  const read = ts.readConfigFile(
    path.join(cwd, "tsconfig.json"),
    ts.sys.readFile,
  );
  assert.equal(read.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, cwd);
  assert.deepEqual(parsed.errors, []);
  return parsed;
}
test("the shipped TypeScript config checks browser code and the scaffold keeps its comments", async (t) => {
  const cwd = await fixture(t, {
    "src/app.ts":
      "import './style.css';document.body.textContent = String(42);",
    "src/style.css": "body{color:green}",
  });
  create.tsconfig(path.join(cwd, "tsconfig.json"), undefined, "src/app.ts");
  const source = await fs.readFile(path.join(cwd, "tsconfig.json"), "utf8");
  assert.ok(source.includes("Find imported files the way a bundler does"));
  const parsed = options(cwd);
  assert.equal(
    parsed.options.moduleResolution,
    ts.ModuleResolutionKind.Bundler,
  );
  assert.equal(parsed.options.noEmit, true);
  await fs.writeFile(
    path.join(cwd, "tinybuild-env.d.ts"),
    "// user declarations\ndeclare module '*.css' {}\n",
  );
  create.tsconfig(path.join(cwd, "tsconfig.json"));
  assert.match(
    await fs.readFile(path.join(cwd, "tinybuild-env.d.ts"), "utf8"),
    /user declarations/,
  );
  assert.deepEqual(
    ts.getPreEmitDiagnostics(
      ts.createProgram(parsed.fileNames, parsed.options),
    ),
    [],
  );
  create.tsconfig(path.join(cwd, "tsconfig.json"), "custom replacement");
  assert.equal(
    await fs.readFile(path.join(cwd, "tsconfig.json"), "utf8"),
    source,
  );
});

for (const name of ["default_ts", "worker_types"])
  test(`the ${name} example checks with its shipped config and asset declarations`, () => {
    const cwd = fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
    const parsed = options(cwd);
    assert.deepEqual(
      ts.getPreEmitDiagnostics(
        ts.createProgram(parsed.fileNames, parsed.options),
      ),
      [],
    );
  });

test("worker companion declarations type both shorthand spellings and their helpers", async (t) => {
  const declarations = `declare const url:string;
export default url;
export declare function createWorker(options?:WorkerOptions):Worker;
export declare function revokeWorkerURL():void;`;
  const cwd = await fixture(t, {
    "index.ts": `import url, {createWorker, revokeWorkerURL} from './flow.worker';
import capitalURL, {createWorker as createCapital} from './other.Worker';
const paths:string[]=[url,capitalURL];
const worker:Worker=createWorker({name:'example'});
createCapital().terminate();worker.terminate();revokeWorkerURL();
// @ts-expect-error A worker URL is a string, not a Worker.
const invalid:Worker=url;
// @ts-expect-error Worker options must be an object.
createWorker(42);
console.log(paths);`,
    "flow.worker.js": "postMessage(42);",
    "other.Worker.ts": "postMessage(42);",
    "flow.d.worker.ts": declarations,
    "other.d.Worker.ts": declarations,
  });
  create.tsconfig(path.join(cwd, "tsconfig.json"), undefined, "index.ts");
  const parsed = options(cwd);
  parsed.options.allowArbitraryExtensions = true;
  const diagnostics = ts.getPreEmitDiagnostics(
    ts.createProgram(parsed.fileNames, parsed.options),
  );
  assert.deepEqual(
    diagnostics.map((item) =>
      ts.flattenDiagnosticMessageText(item.messageText, "\n"),
    ),
    [],
  );
});
test("the shipped TypeScript config generates declarations when bundleTypes enables emitting", async (t) => {
  const cwd = await fixture(t, {
    "index.ts":
      "export interface Point {x:number;y:number} export const point:Point={x:1,y:2};",
  });
  create.tsconfig(path.join(cwd, "tsconfig.json"), undefined, "index.ts");
  const results = await bundle({
    absWorkingDir: cwd,
    entryPoints: ["index.ts"],
    outfile: "dist/index",
    bundleESM: true,
    bundleTypes: true,
    autoInstall: false,
  });
  assert.ok(
    results[0].ts.outputs.some((file) => file.text.includes("interface Point")),
  );
  assert.equal(
    options(cwd).options.noEmit,
    true,
    "Do not rewrite the user's type-checking mode",
  );
});
test("the documented NodeNext variant checks real Node imports without deprecated settings", async (t) => {
  const cwd = await fixture(t, {
    "package.json": '{"type":"module"}',
    "index.ts":
      "import {readFile} from 'node:fs/promises'; export const load=()=>readFile('example.txt','utf8');",
  });
  const parsed = ts.parseConfigFileTextToJson("tsconfig.json", template).config;
  Object.assign(parsed.compilerOptions, {
    module: "NodeNext",
    moduleResolution: "NodeNext",
    lib: ["ES2022"],
    types: ["node"],
    typeRoots: [
      fileURLToPath(new URL("../node_modules/@types", import.meta.url)),
    ],
  });
  await fs.writeFile(
    path.join(cwd, "tsconfig.json"),
    JSON.stringify({ ...parsed, include: ["index.ts"] }),
  );
  const node = options(cwd);
  assert.deepEqual(
    ts.getPreEmitDiagnostics(ts.createProgram(node.fileNames, node.options)),
    [],
  );
});
test("minifyWhitespace can be selected independently when full minification is disabled", async () => {
  const source = "const longName = 4;\nconsole.log(longName);";
  const result = await transform(source, {
    minify: false,
    minifyWhitespace: true,
  });
  assert.match(result.code, /console.log\(longName\)/);
  assert.doesNotMatch(result.code, /longName =/);
});
