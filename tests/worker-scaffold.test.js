import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { scaffoldWorker } from "../tinybuild/starters.js";
import { runTinybuild } from "../tinybuild/cli.js";
import { bundle, bundleBrowser } from "../tinybuild/esbuild/bundler.js";
import { fixture, terminalEnv } from "./helpers.js";
const execute = promisify(execFile);

for (const runtime of ["browser", "node"])
  for (const typescript of [false, true])
    test(`generated ${runtime} ${typescript ? "TypeScript" : "JavaScript"} workers build and return 42`, async (t) => {
      const cwd = await fixture(t, {
        "package.json": '{"type":"module"}',
        "keep.txt": "original",
      });
      const result = await scaffoldWorker("src/flow.Worker", {
        cwd,
        runtime,
        typescript,
      });
      assert.equal(result.specifier, "./src/flow.Worker");
      assert.equal(result.files.length, typescript ? 2 : 1);
      assert.equal(
        await fs.readFile(path.join(cwd, "keep.txt"), "utf8"),
        "original",
      );
      await fs.writeFile(
        path.join(cwd, "index." + (typescript ? "ts" : "js")),
        result.usage,
      );
      if (typescript) {
        const options = {
          strict: true,
          noEmit: true,
          allowArbitraryExtensions: true,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          target: ts.ScriptTarget.ES2022,
          types: [],
          ...(runtime === "node"
            ? {
                types: ["node"],
                typeRoots: [
                  fileURLToPath(
                    new URL("../node_modules/@types", import.meta.url),
                  ),
                ],
                lib: ["lib.es2022.d.ts"],
              }
            : {}),
        };
        const diagnostics = ts.getPreEmitDiagnostics(
          ts.createProgram(
            [path.join(cwd, "index.ts"), path.join(cwd, result.files[0])],
            options,
          ),
        );
        assert.deepEqual(
          diagnostics.map((x) =>
            ts.flattenDiagnosticMessageText(x.messageText, "\n"),
          ),
          [],
        );
      }
      const settings = {
        absWorkingDir: cwd,
        entryPoints: ["index." + (typescript ? "ts" : "js")],
        outfile: "dist/index",
        autoInstall: false,
        ...result.settings,
      };
      if (runtime === "node") {
        await bundle(settings);
        for (const color of [false, true]) {
          const executed = await execute(process.execPath, ["dist/index.js"], {
            cwd,
            timeout: 5000,
            env: terminalEnv(color),
          });
          assert.equal(stripVTControlCharacters(executed.stdout).trim(), "42");
          assert.equal(executed.stdout.includes("\u001b["), color);
        }
      } else {
        const built = await bundleBrowser({ ...settings, write: false });
        let blob;
        vm.runInNewContext(built.outputFiles[0].text, {
          Blob,
          URL: {
            createObjectURL(value) {
              blob = value;
              return "blob:worker";
            },
          },
          Worker: class {
            postMessage() {}
            terminate() {}
          },
        });
        const replies = [],
          context = { postMessage: (value) => replies.push(value) };
        vm.runInNewContext(await blob.text(), context);
        context.onmessage({ data: 21 });
        assert.deepEqual(replies, [42]);
      }
    });

test("worker CLI dry runs return versioned JSON and do not create files or load the config", async (t) => {
  const cwd = await fixture(t, {
    "tinybuild.config.js": "throw Error('must not run');",
  });
  const lines = [];
  const result = await runTinybuild(
    ["init", "--worker", "tasks/flow.worker.ts", "--dryRun", "--json"],
    { cwd, write: (line) => lines.push(line) },
  );
  assert.equal(result.typescript, true);
  assert.equal(JSON.parse(lines[0]).schemaVersion, 1);
  assert.deepEqual(await fs.readdir(cwd), ["tinybuild.config.js"]);
  await assert.rejects(
    runTinybuild(["init", "--worker", "flow", "--example", "default"], { cwd }),
    /Choose/,
  );
  await assert.rejects(
    runTinybuild(["init", "--worker", "flow", "--list"], { cwd }),
    /without --list/,
  );
});

test("worker CLI creates files in an existing app and prints a copyable usage example", async (t) => {
  const cwd = await fixture(t, {
      "tinybuild.config.js": "throw Error('must not execute');",
    }),
    lines = [];
  await runTinybuild(["init", "--worker", "flow.Worker", "--typescript"], {
    cwd,
    log: (line) => lines.push(line),
  });
  assert.match(lines[0], /Created:\n  flow.Worker.ts\n  flow.d.Worker.ts/);
  assert.ok(
    lines.some((line) =>
      line.includes(
        'import { createWorker } from "./flow.Worker";\nconst worker',
      ),
    ),
  );
  assert.equal(
    await fs.readFile(path.join(cwd, "tinybuild.config.js"), "utf8"),
    "throw Error('must not execute');",
  );
  await fs.access(path.join(cwd, "flow.d.Worker.ts"));
});

test("worker generation refuses collisions, shadowing, path escapes and invalid runtimes", async (t) => {
  const cwd = await fixture(t, {
    "flow.worker.js": "keep",
    "named.d.Worker.ts": "keep declaration",
  });
  for (const name of [
    "../outside",
    "C:/outside",
    "./../outside",
    "folder/../../outside",
    "CON",
    "bad\nname",
    "a/",
    "flow.worker.mjs",
  ])
    await assert.rejects(scaffoldWorker(name, { cwd }), /relative|Generated/);
  await assert.rejects(
    scaffoldWorker("flow", { cwd, typescript: true }),
    /shadow/,
  );
  await assert.rejects(
    scaffoldWorker("named.Worker", { cwd, typescript: true }),
    /shadow/,
  );
  await assert.rejects(
    scaffoldWorker("other.ts", { cwd, typescript: false }),
    /disagree/,
  );
  await assert.rejects(
    scaffoldWorker("other", { cwd, runtime: "python" }),
    /runtime/,
  );
  await assert.rejects(
    scaffoldWorker("other", { cwd, typescript: "true" }),
    /true or false/,
  );
  assert.equal(
    await fs.readFile(path.join(cwd, "flow.worker.js"), "utf8"),
    "keep",
  );
});

test("worker generation does not follow linked source directories outside the project", async (t) => {
  const cwd = await fixture(t),
    outside = await fixture(t);
  await fs.symlink(
    outside,
    path.join(cwd, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(scaffoldWorker("linked/flow", { cwd }), /escapes/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("worker generation rolls back its source if writing the companion fails", async (t) => {
  const cwd = await fixture(t),
    open = fs.open;
  t.mock.method(fs, "open", async (filename, ...args) => {
    const handle = await open(filename, ...args);
    if (!filename.endsWith(".d.worker.ts")) return handle;
    return {
      writeFile: async () => {
        await handle.writeFile("partial");
        throw Error("disk full");
      },
      close: () => handle.close(),
    };
  });
  await assert.rejects(
    scaffoldWorker("flow", { cwd, typescript: true }),
    /disk full/,
  );
  assert.deepEqual(await fs.readdir(cwd), []);
});
