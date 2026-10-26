import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { serve } from "../tinybuild/node_server/server.js";
import { packager } from "../tinybuild/packager.js";
import { runTinybuild } from "../tinybuild/cli.js";
import { parseArgs } from "../tinybuild/commands/command.js";
import { validateConfig } from "../tinybuild/config-options.js";
import { previewConfig } from "../tinybuild/preview.js";
import {
  browserURL,
  openBrowser,
  loadEnvironment,
  probeServer,
} from "../tinybuild/server-tools.js";
import { fixture, request, listening, delay } from "./helpers.js";
const execute = promisify(execFile);

test("HTTP response records include status and duration once, omit query strings, and isolate logging failures", async (t) => {
  const records = [];
  const app = await serve({
    host: "127.0.0.1",
    port: 0,
    hotreload: false,
    onRequest: (record) => {
      records.push(record);
      throw Error("logging unavailable");
    },
    routes: {
      "/api": (req, res) => {
        res.end("ok");
        return true;
      },
    },
  });
  t.after(() => app.close());
  assert.equal(
    (await request(app.SERVER, "/api?token=secret-value")).status,
    200,
  );
  await delay(20);
  assert.equal(records.length, 1);
  assert.equal(records[0].path, "/api");
  assert.equal(records[0].status, 200);
  assert.ok(records[0].durationMs >= 0);
  assert.ok(!JSON.stringify(records).includes("secret-value"));
});

test("development port fallback is bounded, reports the actual address and production keeps its exact port", async (t) => {
  const busy = await listening(http.createServer().listen(0, "127.0.0.1"));
  t.after(() => new Promise((resolve) => busy.close(resolve)));
  const port = busy.address().port;
  const app = await serve({
    host: "127.0.0.1",
    port,
    portRetries: 10,
    hotreload: false,
  });
  t.after(() => app.close());
  assert.ok(app.port > port && app.port <= port + 10);
  assert.equal(app.requestedPort, port);
  assert.ok(app.url.endsWith(":" + app.port));
  assert.equal((await request(app.SERVER, "/_tinybuild/ready")).status, 200);
  for (const production of [true, false])
    await assert.rejects(
      serve({
        host: "127.0.0.1",
        port,
        production,
        portRetries: production ? 10 : 0,
        hotreload: true,
      }),
      (error) =>
        error.code === "EADDRINUSE" && /already in use/.test(error.message),
    );
});

test("readiness supports dependencies, failure isolation, HEAD, methods and manual draining", async (t) => {
  let healthy = true,
    fail = false;
  const app = await serve({
    host: "127.0.0.1",
    port: 0,
    hotreload: false,
    isReady: async () => {
      if (fail) throw Error("private dependency detail");
      return healthy;
    },
    onError: () => {
      throw Error("logger failed");
    },
  });
  t.after(() => app.close());
  assert.equal(
    (await request(app.SERVER, "/_tinybuild/ready")).body,
    '{"ready":true}',
  );
  healthy = false;
  const unavailable = await request(app.SERVER, "/_tinybuild/ready");
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers["cache-control"], "no-store");
  healthy = true;
  fail = true;
  assert.equal(
    (await request(app.SERVER, "/_tinybuild/ready")).body,
    '{"ready":false}',
  );
  fail = false;
  app.setReady(false);
  assert.equal(
    (await request(app.SERVER, "/_tinybuild/ready", { method: "HEAD" })).status,
    503,
  );
  app.setReady(true);
  assert.equal(
    (await request(app.SERVER, "/_tinybuild/ready", { method: "POST" })).status,
    405,
  );
  assert.equal((await request(app.SERVER, "/_tinybuild/ready")).status, 200);
});

test("idle response deadlines end stuck handlers while active streams finish normally", async (t) => {
  const app = await serve({
    host: "127.0.0.1",
    port: 0,
    hotreload: false,
    responseTimeout: 150,
    routes: {
      "/stuck": () => new Promise(() => {}),
      "/stream": (req, res) =>
        new Promise((resolve) => {
          let count = 0;
          const timer = setInterval(() => {
            res.write("tick");
            if (++count === 5) {
              clearInterval(timer);
              res.end();
              resolve(true);
            }
          }, 50);
          res.once("close", () => {
            clearInterval(timer);
            resolve(true);
          });
        }),
      "/error": () => {
        throw Error("secret");
      },
    },
    onError: () => {
      throw Error("broken logger");
    },
  });
  t.after(() => app.close());
  const response = await request(app.SERVER, "/stuck");
  assert.equal(response.status, 504);
  assert.equal(response.body, "Response timed out");
  assert.equal((await request(app.SERVER, "/stream")).body, "tick".repeat(5));
  assert.equal((await request(app.SERVER, "/error")).status, 500);
  assert.equal((await request(app.SERVER, "/_tinybuild/ready")).status, 200);
});

test("production cache rules match URL boundaries and extensions with explicit route headers winning", async (t) => {
  const cwd = await fixture(t, {
    "dist/index.html": "home",
    "dist/assets/app.js": "code",
    "dist/else.js": "else",
    "dist/assets2/app.js": "other",
  });
  const app = await serve({
    cwd,
    production: true,
    host: "127.0.0.1",
    port: 0,
    cacheControl: {
      "/assets/": "public, max-age=31536000, immutable",
      ".html": "no-cache",
      "*": "public, max-age=60",
    },
    routes: {
      "/custom": {
        path: "dist/assets/app.js",
        headers: { "Cache-Control": "private, no-store" },
      },
    },
  });
  t.after(() => app.close());
  for (const [url, expected] of [
    ["/", "no-cache"],
    ["/assets/app.js", "public, max-age=31536000, immutable"],
    ["/assets2/app.js", "public, max-age=60"],
    ["/else.js", "public, max-age=60"],
    ["/custom", "private, no-store"],
  ])
    assert.equal(
      (await request(app.SERVER, url)).headers["cache-control"],
      expected,
    );
});

test("portable HTML uses the same default production root in preview, initial serving and rebuilds", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "document.body.textContent='production hello';",
  });
  const config = {
    production: true,
    bundler: {
      entryPoints: ["index.js"],
      outfile: "dist/index",
      bundleHTML: true,
      autoInstall: false,
    },
    server: { host: "127.0.0.1", port: 0 },
  };
  const app = await packager(config, { cwd });
  t.after(() => app.close());
  assert.equal(
    previewConfig(config, { cwd }).server.root,
    path.join(cwd, "dist"),
  );
  assert.match((await request(app.server.SERVER)).body, /production hello/);
  await fs.writeFile(
    path.join(cwd, "index.js"),
    "document.body.textContent='updated production';",
  );
  await app.rebuild();
  assert.match((await request(app.server.SERVER)).body, /updated production/);
  assert.equal(app.server.startpage, "index.html");
});

test("a server-level production flag is preserved and failed builds turn readiness off until recovery", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "console.log(1)",
    "index.html": "app",
  });
  const production = await packager(
    {
      bundler: false,
      server: { production: true, root: ".", host: "127.0.0.1", port: 0 },
    },
    { cwd },
  );
  assert.equal(production.server.production, true);
  assert.equal(production.watcher, undefined);
  assert.deepEqual(
    previewConfig({ bundler: false, server: { production: true } }, { cwd })
      .watch,
    [],
  );
  assert.equal(production.server.SOCKETS.hotreload, undefined);
  await production.close();
  const app = await packager(
    {
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
        logLevel: "silent",
      },
      server: { host: "127.0.0.1", port: 0 },
    },
    { cwd, watch: false },
  );
  t.after(() => app.close());
  await fs.writeFile(path.join(cwd, "index.js"), "broken syntax = !!!");
  await assert.rejects(app.rebuild());
  assert.equal(
    (await request(app.server.SERVER, "/_tinybuild/ready")).status,
    503,
  );
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(2)");
  await app.rebuild();
  assert.equal(
    (await request(app.server.SERVER, "/_tinybuild/ready")).status,
    200,
  );
});

test("environment files load before config, preserve shell values and apply nothing after a missing file", async (t) => {
  const cwd = await fixture(t, {
    "first.env": "NAME=first\nVALUE=first\nSECRET='do not print'",
    "second.env": "VALUE=second\nPORT=0\n",
    "private.key.gz": "private compressed key",
    "certificate.p12": "private certificate",
    "android.keystore": "private keystore",
    "deployment.env.local": "private values",
  });
  const env = { NAME: "shell" };
  const result = await loadEnvironment(["first.env", "second.env"], {
    cwd,
    env,
  });
  assert.deepEqual(env, {
    NAME: "shell",
    VALUE: "second",
    SECRET: "do not print",
    PORT: "0",
  });
  assert.ok(!JSON.stringify(result).includes("do not print"));
  const empty = {};
  await assert.rejects(
    loadEnvironment(["first.env", "missing.env"], { cwd, env: empty }),
  );
  assert.deepEqual(empty, {});
  const key = "TINYBUILD_ENV_TEST_" + Date.now();
  await fs.writeFile(path.join(cwd, "app.env"), key + "=0");
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    `export default {bundler:false,server:{port:Number(process.env.${key}),host:'127.0.0.1',hotreload:false}};`,
  );
  try {
    const app = await runTinybuild(["serve", "--envFile", "app.env"], { cwd });
    try {
      assert.ok(app.server.port > 0);
      for (const filename of [
        "app.env",
        "private.key.gz",
        "certificate.p12",
        "android.keystore",
        "deployment.env.local",
      ])
        assert.equal(
          (await request(app.server.SERVER, "/" + filename)).status,
          403,
        );
    } finally {
      await app.close();
    }
  } finally {
    delete process.env[key];
  }
});

test("CLI dev opens its actual URL once; serve bypasses inherited native actions", async (t) => {
  const cwd = await fixture(t, {
    "index.html": "home",
    "index.js": "console.log(1)",
    "tinybuild.config.mjs":
      "export default {production:true,bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false},server:{root:'.',host:'127.0.0.1',port:0},electron:{action:'open'}};",
  });
  let calls = 0;
  const served = await runTinybuild(["serve"], {
    cwd,
    native: {
      run: async () => {
        throw Error("must not launch");
      },
    },
  });
  assert.equal(served.native, undefined);
  await served.close();
  const app = await runTinybuild(["dev", "--open=/settings", "--no-electron"], {
    cwd,
    watch: false,
    openBrowser: async (url) => {
      calls++;
      assert.ok(url.endsWith(":" + appPort(url) + "/settings"));
    },
  });
  function appPort(url) {
    return new URL(url).port;
  }
  t.after(() => app.close());
  assert.equal(app.server.production, false);
  assert.ok(app.server.SOCKETS.hotreload);
  await app.rebuild();
  assert.equal(calls, 1);
  await assert.rejects(
    runTinybuild(["dev", "--production"], { cwd }),
    /cannot use/,
  );
});

test("explicit CLI build and serve modes override opposite modes stored in the config", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "console.log(1)",
    "index.html": "home",
    "tinybuild.config.mjs":
      "export default {build:true,bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false},server:{port:0,host:'127.0.0.1',hotreload:false}};",
  });
  const serving = await runTinybuild(["serve"], { cwd });
  assert.ok(serving.server);
  await serving.close();
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default {serve:true,bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false},server:{port:0,host:'127.0.0.1'}};",
  );
  const built = await runTinybuild(["build"], { cwd });
  assert.equal(built.server, undefined);
  assert.ok(built.bundles[0].browser);
  await built.close();
  const apiConfig = {
    serve: true,
    production: true,
    bundler: { entryPoints: ["absent.js"] },
    server: { root: ".", port: 0, host: "127.0.0.1" },
    electron: { action: "open", liveReload: true },
  };
  const served = await packager(apiConfig, {
    cwd,
    native: {
      run: async () => {
        throw Error("must not launch");
      },
    },
  });
  assert.equal(served.native, undefined);
  assert.equal(served.bundles.length, 0);
  assert.equal(served.watcher, undefined);
  assert.deepEqual(previewConfig(apiConfig, { cwd }).native, []);
  await served.close();
  await assert.rejects(
    runTinybuild(["build", "serve"], { cwd }),
    /Choose build or serve/,
  );
});

test("status checks report readiness, timeout and CLI failure without scaffolding or running custom scripts", async (t) => {
  const app = await serve({
    host: "127.0.0.1",
    port: 0,
    hotreload: false,
    routes: { "/slow": () => new Promise(() => {}) },
  });
  t.after(() => app.close());
  assert.equal((await probeServer(app.url + "/_tinybuild/ready")).ready, true);
  app.setReady(false);
  const cwd = await fixture(t, {
    "tinybuild.js": "throw new Error('must not execute');",
  });
  const result = await runTinybuild(
    ["status", "--url", app.url + "/_tinybuild/ready"],
    { cwd },
  );
  assert.equal(result.status, 503);
  assert.deepEqual(await fs.readdir(cwd), ["tinybuild.js"]);
  assert.equal(
    (await probeServer(app.url + "/slow", { timeout: 30 })).ready,
    false,
  );
  const cli = fileURLToPath(
    new URL("../tinybuild/bin/global.js", import.meta.url),
  );
  await assert.rejects(
    execute(
      process.execPath,
      [cli, "status", "--url", app.url + "/_tinybuild/ready"],
      { cwd, windowsHide: true },
    ),
    (error) => error.code === 1 && error.stdout.includes('"ready": false'),
  );
});

test("browser opening uses argument arrays on each OS and validates page paths", async () => {
  const calls = [];
  for (const platform of ["win32", "darwin", "linux"])
    await openBrowser("http://localhost:8080/a?x=1&y=2", {
      platform,
      run: async (...args) => calls.push(args),
    });
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["rundll32.exe", "open", "xdg-open"],
  );
  assert.ok(
    calls.every((call) => call[1].at(-1) === "http://localhost:8080/a?x=1&y=2"),
  );
  assert.equal(
    browserURL("http://0.0.0.0:8000", "/debug"),
    "http://localhost:8000/debug",
  );
  assert.throws(
    () => browserURL("http://localhost:8080", "//elsewhere.test"),
    /this server/,
  );
  await assert.rejects(openBrowser("file:///private"), /HTTP/);
});

test("new server options validate consistently and TLS paths resolve from the configured project", async (t) => {
  for (const settings of [
    { portRetries: -1 },
    { portRetries: 101 },
    { responseTimeout: -1 },
    { open: 7 },
    { cacheControl: { bad: "no-cache" } },
    { cacheControl: { ".js": "bad\r\nheader" } },
    { isReady: true },
  ])
    assert.ok(validateConfig({ server: settings }).errors.length);
  assert.deepEqual(
    parseArgs(["--portRetries", "2", "--open", "--responseTimeout", "500"]),
    { server: { portRetries: 2, open: true, responseTimeout: 500 } },
  );
  const cwd = await fixture(t, {
    "test.key": "invalid test key",
    "test.crt": "invalid test certificate",
  });
  await assert.rejects(
    serve({
      cwd,
      protocol: "https",
      keypath: "test.key",
      certpath: "test.crt",
      port: 0,
      hotreload: false,
    }),
    (error) => error.code !== "ENOENT",
  );
});
