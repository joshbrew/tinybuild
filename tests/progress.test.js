import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { bundle, createBuildContexts } from "../tinybuild/esbuild/bundler.js";
import { runTinybuild } from "../tinybuild/cli.js";
import { fixture, until, delay } from "./helpers.js";

const execute = promisify(execFile);
const cli = fileURLToPath(
  new URL("../tinybuild/bin/global.js", import.meta.url),
);

test("one-shot and incremental progress measure every format, declaration, HTML and gzip output", async (t) => {
  const cwd = await fixture(t, {
    "index.ts": "export const answer: number = 42;",
  });
  const config = {
    absWorkingDir: cwd,
    entryPoints: ["index.ts"],
    outfile: "dist/index",
    bundleBrowser: true,
    bundleESM: true,
    bundleTypes: true,
    bundleHTML: true,
    bundleGzip: true,
    autoInstall: false,
  };
  for (const incremental of [false, true]) {
    const events = [];
    const options = { onProgress: (event) => events.push(event) };
    const contexts = incremental
      ? await createBuildContexts(config, options)
      : undefined;
    try {
      const [group] = await (contexts
        ? contexts.rebuild()
        : bundle(config, options));
      assert.deepEqual(
        events.map(({ target, phase }) => target + ":" + phase),
        [
          "browser:start",
          "browser:end",
          "esm:start",
          "esm:end",
          "types:start",
          "types:end",
        ],
      );
      const completed = events.filter((event) => event.phase === "end");
      for (const event of completed) {
        assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0);
        assert.ok(event.outputs.length);
        for (const output of event.outputs) {
          assert.ok(path.isAbsolute(output.path));
          assert.equal(output.bytes, (await fs.stat(output.path)).size);
        }
      }
      const browserFiles = completed[0].outputs.map((output) => output.path);
      assert.ok(browserFiles.includes(group.browser.html));
      assert.ok(
        group.browser.gzipFiles.every((file) => browserFiles.includes(file)),
      );
      assert.ok(
        completed[2].outputs.every((output) => output.path.endsWith(".d.ts")),
      );
    } finally {
      await contexts?.dispose();
    }
  }
});

test("human progress includes sizes and durations, recovers from errors and ends with the live URL", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "console.log(42);",
    "index.html": "hello",
    "public/hello.txt": "copied file",
    "tinybuild.config.mjs":
      "export default {bundler:{entryPoints:['index.js'],outfile:'dist/index',bundleBrowser:true,bundleESM:true,autoInstall:false,logLevel:'silent'},copy:[{from:'public/hello.txt',to:'dist/hello.txt'}],server:{host:'127.0.0.1',port:0}};",
  });
  const lines = [];
  const app = await runTinybuild([], {
    cwd,
    watch: false,
    log: (line) => lines.push(line),
    onError() {},
  });
  t.after(() => app.close());
  const url = "Tinybuild listening at " + app.server.url;
  assert.match(lines[0], /✨ esbuild starting/);
  assert.ok(
    lines.some((line) =>
      /☄️ Built browser \(iife\): dist\/index.js — \d+(?:\.\d+)? (?:B|KiB|MiB) in \d+\.\d ms/.test(
        line,
      ),
    ),
  );
  assert.ok(
    lines.some((line) => /🌌 Built esm \(esm\): dist\/index.esm.js/.test(line)),
  );
  assert.match(
    lines.at(-2),
    /🚀 Package finished: 3 build outputs, .* in \d+\.\d ms/,
  );
  assert.ok(
    lines.some((line) =>
      /🗂️ Copied assets: dist\/hello.txt — 11 B in \d+\.\d ms/.test(line),
    ),
  );
  assert.equal(lines.at(-1), url);
  lines.length = 0;
  await fs.writeFile(path.join(cwd, "index.js"), "const = ;");
  await assert.rejects(app.rebuild(["index.js"]));
  assert.equal(
    lines.some((line) => /Built |Package finished|listening/.test(line)),
    false,
  );
  lines.length = 0;
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(84);");
  await app.rebuild(["index.js"]);
  assert.match(lines.at(-2), /🚀 Package finished/);
  assert.equal(lines.at(-1), url);
  assert.equal(
    lines.filter((line) => /🚀 Package finished/.test(line)).length,
    1,
  );
});

test("ten saved sources produce one package summary and URL without restarting the server", async (t) => {
  const parts = Array.from(
    { length: 10 },
    (_, index) => "part" + index + ".js",
  );
  const cwd = await fixture(t, {
    ...Object.fromEntries(parts.map((file) => [file, "export default 1;"])),
    "index.js":
      parts
        .map((file, index) => `import p${index} from './${file}';`)
        .join("") +
      "console.log(" +
      parts.map((_, index) => "p" + index).join(",") +
      ");",
    "tinybuild.config.mjs":
      "export default {bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false},server:{host:'127.0.0.1',port:0,delay:150}};",
  });
  const lines = [];
  const app = await runTinybuild([], { cwd, log: (line) => lines.push(line) });
  t.after(() => app.close());
  const server = app.server;
  lines.length = 0;
  await Promise.all(
    parts.map((file) =>
      fs.writeFile(path.join(cwd, file), "export default 2;"),
    ),
  );
  await until(() => app.stats.builds === 2);
  await delay(350);
  assert.equal(app.server, server);
  assert.equal(
    lines.filter((line) => /🚀 Package finished/.test(line)).length,
    1,
  );
  assert.equal(
    lines.filter((line) => /Tinybuild listening/.test(line)).length,
    1,
  );
  assert.match(lines.at(-2), /🚀 Package finished/);
  assert.equal(lines.at(-1), "Tinybuild listening at " + server.url);
});

test("the actual CLI retains friendly output when piped and JSON contains only its established events", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "console.log(42);",
    "tinybuild.config.mjs":
      "export default {bundler:{entryPoints:['index.js'],outfile:'dist/index',bundleHTML:true,bundleGzip:true,autoInstall:false},server:false};",
  });
  const human = await execute(process.execPath, [cli, "build"], { cwd });
  assert.match(human.stdout, /✨ esbuild starting/);
  assert.match(human.stdout, /📄 Self-contained HTML: dist\/index.html — \d+/);
  assert.match(human.stdout, /🗜️ Gzip: .*dist\/index.html.gz/);
  assert.match(human.stdout, /🚀 Package finished/);
  assert.equal(human.stderr, "");
  const machine = await execute(process.execPath, [cli, "build", "--json"], {
    cwd,
  });
  const events = machine.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(
    events.map((event) => event.type),
    ["building", "built", "ready", "closed"],
  );
  assert.equal(machine.stderr, "");
});
