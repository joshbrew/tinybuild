import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { bundle, createBuildContexts } from "../tinybuild/esbuild/bundler.js";
import { packager } from "../tinybuild/packager.js";
import { generatePWA } from "../tinybuild/native.js";
import { cleanGenerated } from "../tinybuild/outputs.js";
import { fixture } from "./helpers.js";

test("hashed multi-page HTML retains each page's matching CSS in one-shot and incremental builds", async (t) => {
  const cwd = await fixture(t, {
    "a.js": 'import "./a.css"; console.log("a");',
    "a.css": "body{color:red}",
    "b.js": 'import "./b.css"; console.log("b");',
    "b.css": "body{color:blue}",
  });
  const config = {
    absWorkingDir: cwd,
    entryPoints: ["a.js", "b.js"],
    outdir: "dist",
    entryNames: "[name]-[hash]",
    bundleHTML: true,
    autoInstall: false,
  };
  for (const incremental of [false, true]) {
    const contexts = incremental
      ? await createBuildContexts(config)
      : undefined;
    try {
      const [group] = await (contexts ? contexts.rebuild() : bundle(config));
      assert.equal(group.browser.htmlFiles.length, 2);
      for (const html of group.browser.htmlFiles) {
        const content = await fs.readFile(html, "utf8");
        const a = path.basename(html).startsWith("a-");
        assert.match(content, a ? /color: ?red/ : /color: ?blue/);
        assert.doesNotMatch(content, a ? /color: ?blue/ : /color: ?red/);
      }
    } finally {
      await contexts?.dispose();
    }
  }
});

test("all portable pages are measured, cached and recorded for safe generated-file cleanup", async (t) => {
  const cwd = await fixture(t, {
    "a.js": "console.log('a');",
    "b.js": "console.log('b');",
  });
  const app = await packager(
    {
      bundler: {
        entryPoints: ["a.js", "b.js"],
        outdir: "dist",
        bundleHTML: true,
        autoInstall: false,
      },
      server: false,
    },
    { cwd },
  );
  t.after(() => app.close());
  const html = app.bundles[0].browser.htmlFiles;
  assert.equal(html.length, 2);
  for (const file of html) {
    const output = app.report.outputs.find(
      (output) => path.resolve(cwd, output.path) === file,
    );
    assert.equal(output.bytes, (await fs.stat(file)).size);
  }
  const pwa = await generatePWA({ cwd, results: app.bundles });
  const source = await fs.readFile(pwa.filename, "utf8");
  for (const file of html)
    assert.ok(
      source.includes("/" + path.relative(cwd, file).split(path.sep).join("/")),
    );
  const cleaned = await cleanGenerated({ cwd });
  for (const file of html)
    assert.ok(
      cleaned.removed.includes(
        path.relative(cwd, file).split(path.sep).join("/"),
      ),
    );
});

test("portable HTML supports mjs output names and worker-specific file and copy loaders", async (t) => {
  const cwd = await fixture(t, {
    "index.js": 'import worker from "./task.worker.js";new Worker(worker);',
    "task.worker.js": 'import data from "./payload.custom";postMessage(data);',
    "payload.custom": "portable payload",
  });
  for (const loader of ["file", "copy"]) {
    const [group] = await bundle({
      absWorkingDir: cwd,
      entryPoints: ["index.js"],
      outfile: "dist/index.mjs",
      bundleHTML: true,
      blobWorkers: false,
      workerBundler: { loader: { ".custom": loader } },
      autoInstall: false,
    });
    assert.ok(group.browser.html.endsWith(".html"));
    const html = await fs.readFile(group.browser.html, "utf8");
    assert.match(html, /createObjectURL/);
    assert.match(html, /data:[^"']*portable/);
  }
});

test("portable pages reject external dependencies in main code and nested workers", async (t) => {
  const cwd = await fixture(t, {
    "main.js": 'import x from "external-lib";console.log(x);',
    "nested.js": 'import worker from "./outer.worker.js";new Worker(worker);',
    "outer.worker.js":
      'import worker from "./inner.worker.js";new Worker(worker);',
    "inner.worker.js": 'import x from "external-lib";postMessage(x);',
  });
  for (const entry of ["main.js", "nested.js"]) {
    await assert.rejects(
      bundle({
        absWorkingDir: cwd,
        entryPoints: [entry],
        outfile: "dist/index",
        bundleHTML: true,
        blobWorkers: false,
        external: ["external-lib"],
        logLevel: "silent",
        autoInstall: false,
      }),
      /Self-contained HTML cannot contain external module imports: external-lib/,
    );
  }
});

test("plugins cannot silently leave companion assets in portable main or worker builds", async (t) => {
  const cwd = await fixture(t, {
    "index.js": 'import url from "./payload.custom";console.log(url);',
    "worker-main.js": 'import url from "./task.worker.js";new Worker(url);',
    "task.worker.js": 'import url from "./payload.custom";postMessage(url);',
    "payload.custom": "must be embedded",
  });
  const plugin = {
    name: "custom-file-loader",
    setup(build) {
      build.onLoad({ filter: /\.custom$/ }, async (args) => ({
        contents: await fs.readFile(args.path),
        loader: "file",
      }));
    },
  };
  for (const entry of ["index.js", "worker-main.js"]) {
    await assert.rejects(
      bundle({
        absWorkingDir: cwd,
        entryPoints: [entry],
        outfile: "dist/index",
        bundleHTML: true,
        blobWorkers: false,
        plugins: [plugin],
        logLevel: "silent",
        autoInstall: false,
      }),
      /Self-contained HTML cannot contain emitted companion files:.*Use dataurl loaders/,
    );
  }
});
