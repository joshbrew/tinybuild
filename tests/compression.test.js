import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  bundle,
  bundleBrowser,
  createBuildContexts,
  normalizeBuildOptions,
} from "../tinybuild/esbuild/bundler.js";
import { serve } from "../tinybuild/node_server/server.js";
import { packager } from "../tinybuild/packager.js";
import { cleanGenerated } from "../tinybuild/outputs.js";
import { analyzeBuild } from "../tinybuild/diagnostics.js";
import { validateConfig } from "../tinybuild/config-options.js";
import { parseArgs } from "../tinybuild/commands/command.js";
import { encodingPreferences } from "../tinybuild/compression.js";
import { fixture, until, delay } from "./helpers.js";

const script = 'console.log("hello compressed app");\n'.repeat(150);
function raw(server, pathname = "/", headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port: server.port, path: pathname, headers, method },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end();
  });
}
async function staticServer(t, extra = {}) {
  let server;
  t.after(() => server?.close());
  const cwd = await fixture(t, {
    "app.js": script,
    "index.html": "<h1>App</h1>" + "<!-- padding -->".repeat(100),
    "short.txt": "x",
    "image.png": script,
  });
  for (const filename of ["app.js", "index.html", "short.txt", "image.png"])
    await fs.writeFile(
      path.join(cwd, filename + ".gz"),
      gzipSync(await fs.readFile(path.join(cwd, filename)), { level: 9 }),
    );
  server = await serve({
    cwd,
    host: "127.0.0.1",
    port: 0,
    hotreload: false,
    production: true,
    root: ".",
    ...extra,
  });
  return { server, cwd };
}

test("gzip builds preserve originals and compress formats, CSS, portable HTML, chunks and emitted workers", async (t) => {
  const cwd = await fixture(t, {
    "index.js":
      'import "./style.css";import url from "./task.worker.js";import image from "./image.png";console.log(url,image);',
    "style.css": "body{color:green}",
    "task.worker.js": 'self.onmessage=()=>self.postMessage("worker");',
    "image.png": Buffer.from([1, 2, 3, 4]),
  });
  const results = await bundle({
    absWorkingDir: cwd,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    bundleBrowser: true,
    bundleESM: true,
    bundleHTML: true,
    bundleGzip: true,
    blobWorkers: false,
    autoInstall: false,
  });
  for (const result of [results[0].browser, results[0].esm]) {
    assert.ok(result.gzipFiles.length >= 3);
    for (const filename of result.gzipFiles)
      assert.deepEqual(
        gunzipSync(await fs.readFile(filename)),
        await fs.readFile(filename.slice(0, -3)),
      );
    assert.ok(
      result.gzipFiles.every((filename) => !filename.endsWith(".png.gz")),
    );
  }
  assert.ok(
    results[0].browser.gzipFiles.some((filename) =>
      filename.endsWith(".html.gz"),
    ),
  );
  const single = await bundleBrowser({
    absWorkingDir: cwd,
    entryPoints: ["index.js"],
    outfile: "single/index",
    bundleGzip: true,
    autoInstall: false,
  });
  assert.ok(single.gzipFiles.length);
  const chunks = await bundle({
    absWorkingDir: cwd,
    entryPoints: ["index.js"],
    outdir: "chunks",
    bundleESM: true,
    splitting: true,
    bundleGzip: true,
    autoInstall: false,
  });
  for (const filename of Object.keys(chunks[0].esm.metafile.outputs).filter(
    (filename) => filename.endsWith(".js"),
  ))
    await fs.access(path.resolve(cwd, filename) + ".gz");
});

test("persistent builds refresh gzip, diagnostics use its actual size, and cleanup owns the extra files", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "index.js": 'console.log("first");',
    "index.html": "<h1>App</h1>",
  });
  app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        bundleGzip: true,
        autoInstall: false,
      },
      server: { host: "127.0.0.1", port: 0, delay: 20 },
    },
    { cwd },
  );
  await fs.writeFile(path.join(cwd, "index.js"), 'console.log("second");');
  await until(() => app.stats.builds === 2);
  const output = path.join(cwd, "dist/index.js");
  const zipped = await fs.readFile(output + ".gz");
  assert.match(gunzipSync(zipped).toString(), /second/);
  const report = await analyzeBuild(app.bundles, { cwd, compression: true });
  assert.equal(
    report.outputs.find((file) => file.path === "dist/index.js").gzipBytes,
    zipped.length,
  );
  assert.ok(
    report.outputs.every((file) => !file.path.endsWith(".gz")),
    "Avoid double-counting extra compressed copies in raw budgets",
  );
  await delay(250);
  assert.equal(
    app.stats.builds,
    2,
    "Compressed outputs must not trigger rebuild loops",
  );
  await app.close();
  assert.ok(
    (await cleanGenerated({ cwd, dryRun: true })).removed.includes(
      "dist/index.js.gz",
    ),
  );
  await cleanGenerated({ cwd });
  await assert.rejects(fs.access(output + ".gz"));
});

test("gzip options are typed, discoverable in CLI, and kept out of esbuild options", async () => {
  assert.equal(
    normalizeBuildOptions({ bundleGzip: true }).bundleGzip,
    undefined,
  );
  assert.deepEqual(parseArgs(["--bundleGzip", "--no-precompressed"]), {
    bundler: { bundleGzip: true },
    server: { precompressed: false },
  });
  assert.ok(
    validateConfig(
      { bundler: { bundleGzip: true }, server: { precompressed: true } },
      { strict: true },
    ).errors.length === 0,
  );
  assert.ok(validateConfig({ bundler: { bundleGzip: "yes" } }).errors.length);
  assert.ok(validateConfig({ server: { precompressed: "yes" } }).errors.length);
  await assert.rejects(
    bundle({ bundleGzip: true, write: false }),
    /requires write:true/,
  );
  await assert.rejects(
    createBuildContexts({ bundleGzip: "yes" }),
    /true or false/,
  );
});

test("Accept-Encoding negotiation respects exclusions, wildcard and explicit identity preferences", async (t) => {
  const { server } = await staticServer(t);
  for (const [encoding, compressed, status = 200] of [
    [undefined, false],
    ["", false],
    ["gzip", true],
    ["br, gzip", true],
    ["GZIP", true],
    ["gzip;q=0", false],
    ["*", true],
    ["*;q=0,identity;q=1", false],
    ["gzip;q=0.5,identity;q=0.2", true],
    ["gzip;q=0.2,identity;q=1", false],
    ["gzip;q=invalid", false],
    ["gzip;q=2", false],
    ["br,identity;q=0", false, 406],
    ["*;q=0", false, 406],
  ]) {
    const response = await raw(
      server,
      "/app.js",
      encoding === undefined ? {} : { "Accept-Encoding": encoding },
    );
    assert.equal(response.status, status, encoding);
    assert.equal(
      response.headers["content-encoding"],
      compressed ? "gzip" : undefined,
      encoding,
    );
    if (status === 200)
      assert.equal(
        (compressed ? gunzipSync(response.body) : response.body).toString(),
        script,
      );
  }
  assert.deepEqual(encodingPreferences("gzip;q=0, *;q=1"), {
    gzip: 0,
    identity: 1,
  });
});

test("compressed responses keep content type, length, Vary, HEAD and variant-specific caching correct", async (t) => {
  const { server } = await staticServer(t, { headers: { Vary: "Origin" } });
  const gzip = await raw(server, "/app.js", { "Accept-Encoding": "gzip" });
  const plain = await raw(server, "/app.js");
  assert.match(gzip.headers["content-type"], /javascript/);
  assert.equal(Number(gzip.headers["content-length"]), gzip.body.length);
  assert.equal(gzip.headers.vary, "Origin, Accept-Encoding");
  assert.notEqual(gzip.headers.etag, plain.headers.etag);
  const head = await raw(
    server,
    "/app.js",
    { "Accept-Encoding": "gzip" },
    "HEAD",
  );
  assert.equal(head.body.length, 0);
  assert.equal(head.headers["content-length"], gzip.headers["content-length"]);
  const cached = await raw(server, "/app.js", {
    "Accept-Encoding": "gzip",
    "If-None-Match": gzip.headers.etag,
  });
  assert.equal(cached.status, 304);
  assert.equal(cached.body.length, 0);
  assert.equal(cached.headers["content-length"], undefined);
  assert.equal(cached.headers.vary, "Origin, Accept-Encoding");
  assert.equal(
    (
      await raw(server, "/app.js", {
        "Accept-Encoding": "gzip",
        "If-None-Match": plain.headers.etag,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await raw(server, "/app.js", {
        "Accept-Encoding": "gzip",
        "If-Modified-Since": gzip.headers["last-modified"],
      })
    ).status,
    304,
  );
});

test("ranges use original bytes and gzip-only clients can receive the complete compressed response", async (t) => {
  const { server } = await staticServer(t);
  const part = await raw(server, "/app.js", {
    "Accept-Encoding": "gzip",
    Range: "bytes=0-9",
  });
  assert.equal(part.status, 206);
  assert.equal(part.headers["content-encoding"], undefined);
  assert.equal(part.body.toString(), script.slice(0, 10));
  const gzipOnly = await raw(server, "/app.js", {
    "Accept-Encoding": "gzip,identity;q=0",
    Range: "bytes=0-9",
  });
  assert.equal(gzipOnly.status, 200);
  assert.equal(gzipOnly.headers["accept-ranges"], "none");
  assert.equal(gunzipSync(gzipOnly.body).toString(), script);
});

test("missing, stale, larger and linked sidecars never replace the original response", async (t) => {
  const { server, cwd } = await staticServer(t);
  assert.equal(
    (await raw(server, "/short.txt", { "Accept-Encoding": "gzip" })).headers[
      "content-encoding"
    ],
    undefined,
  );
  assert.equal(
    (await raw(server, "/image.png", { "Accept-Encoding": "gzip" })).headers[
      "content-encoding"
    ],
    undefined,
  );
  const filename = path.join(cwd, "app.js.gz");
  await fs.utimes(filename, new Date(0), new Date(0));
  assert.equal(
    (await raw(server, "/app.js", { "Accept-Encoding": "gzip" })).headers[
      "content-encoding"
    ],
    undefined,
  );
  await fs.unlink(filename);
  assert.equal(
    (
      await raw(server, "/app.js", { "Accept-Encoding": "gzip" })
    ).body.toString(),
    script,
  );
  await fs.writeFile(filename, gzipSync(script, { level: 9 }));
  assert.equal(
    (await raw(server, "/app.js", { "Accept-Encoding": "gzip" })).headers[
      "content-encoding"
    ],
    "gzip",
  );
  if (process.platform !== "win32") {
    await fs.unlink(filename);
    await fs.symlink(path.join(cwd, "index.html.gz"), filename);
    assert.equal(
      (await raw(server, "/app.js", { "Accept-Encoding": "gzip" })).headers[
        "content-encoding"
      ],
      undefined,
    );
  }
});

test("compressed serving can be disabled, while development HTML keeps its injected reload client", async (t) => {
  const disabled = await staticServer(t, { precompressed: false });
  assert.equal(
    (await raw(disabled.server, "/app.js", { "Accept-Encoding": "gzip" }))
      .headers["content-encoding"],
    undefined,
  );
  assert.equal(
    (
      await raw(disabled.server, "/app.js", {
        "Accept-Encoding": "gzip,identity;q=0",
      })
    ).status,
    406,
  );
  const dev = await staticServer(t, { production: false, hotreload: true });
  const html = await raw(dev.server, "/", { "Accept-Encoding": "gzip" });
  assert.equal(html.headers["content-encoding"], undefined);
  assert.match(html.body.toString(), /hotreload/);
  assert.equal(
    (await raw(dev.server, "/", { "Accept-Encoding": "gzip,identity;q=0" }))
      .status,
    406,
  );
});

test("SPA fallback and trusted file routes negotiate the same compressed representation", async (t) => {
  const { server } = await staticServer(t, {
    spa: "index.html",
    routes: { "/script": { path: "app.js" } },
  });
  assert.equal(
    (await raw(server, "/script", { "Accept-Encoding": "gzip" })).headers[
      "content-encoding"
    ],
    "gzip",
  );
  const page = await raw(server, "/settings", {
    Accept: "text/html",
    "Accept-Encoding": "gzip",
  });
  assert.equal(page.status, 200);
  assert.equal(page.headers["content-encoding"], "gzip");
  assert.match(gunzipSync(page.body).toString(), /<h1>App/);
});
