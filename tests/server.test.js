import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import WebSocket from "ws";
import { serve, findRouteCfg } from "../tinybuild/node_server/server.js";
import {
  PythonRelay,
  PythonClient,
} from "../tinybuild/node_server/relay/python_relay.js";
import { fixture, request, until } from "./helpers.js";

async function app(t, extra = {}, files = {}) {
  const root = await fixture(t, {
    "index.html": "<h1>Hello</h1>",
    "asset.txt": "0123456789",
    ".env": "PRIVATE",
    ...files,
  });
  const server = await serve({
    cwd: root,
    host: "127.0.0.1",
    port: 0,
    hotreload: false,
    ...extra,
  });
  t.after(() => server.close());
  return { ...server, fixtureRoot: root };
}
test("static server supports HTML, correct MIME, HEAD, ETag, readiness, and ranges", async (t) => {
  const server = await app(
    t,
    { production: true, root: "." },
    { "font.woff2": "font" },
  );
  const home = await request(server.SERVER);
  assert.equal(home.status, 200);
  assert.match(home.body, /Hello/);
  const asset = await request(server.SERVER, "/asset.txt");
  assert.equal(asset.body, "0123456789");
  const head = await request(server.SERVER, "/asset.txt", { method: "HEAD" });
  assert.equal(head.body, "");
  assert.equal(head.headers["content-length"], "10");
  assert.equal(
    (
      await request(server.SERVER, "/asset.txt", {
        headers: { "If-None-Match": asset.headers.etag },
      })
    ).status,
    304,
  );
  const range = await request(server.SERVER, "/asset.txt", {
    headers: { Range: "bytes=2-4" },
  });
  assert.equal(range.status, 206);
  assert.equal(range.body, "234");
  assert.equal(
    (
      await request(server.SERVER, "/asset.txt", {
        headers: { Range: "bytes=-2" },
      })
    ).body,
    "89",
  );
  assert.equal(
    (
      await request(server.SERVER, "/asset.txt", {
        headers: { Range: "bytes=100-" },
      })
    ).status,
    416,
  );
  assert.equal(
    (await request(server.SERVER, "/font.woff2")).headers["content-type"],
    "font/woff2",
  );
  assert.equal((await request(server.SERVER, "/_tinybuild/ready")).status, 200);
  assert.equal(
    (await request(server.SERVER, "/asset.txt", { method: "POST" })).status,
    405,
  );
});
test("static roots deny private paths, encoded traversal, and escaping symlinks", async (t) => {
  const server = await app(
    t,
    { root: "public" },
    { "public/index.html": "public", "public/ok.txt": "ok" },
  );
  for (const pathname of [
    "/.env",
    "/%2e%2e%2f.env",
    "/node_modules/private.js",
    "/package.json",
  ])
    assert.equal(
      (await request(server.SERVER, pathname)).status,
      403,
      pathname,
    );
  assert.equal((await request(server.SERVER, "/ok.txt")).body, "ok");
  try {
    await fs.symlink(
      path.join(server.fixtureRoot, "asset.txt"),
      path.join(server.fixtureRoot, "public/escape.txt"),
    );
    assert.equal((await request(server.SERVER, "/escape.txt")).status, 403);
  } catch (error) {
    if (!["EPERM", "EACCES"].includes(error.code)) throw error;
    t.diagnostic("Symlink creation unavailable on this host");
  }
});
test("routes support parameters, exact priority, async callbacks, redirects and headers", async (t) => {
  const server = await app(t, {
    headers: { "X-App": "yes" },
    routes: {
      "/user/fixed": { template: "fixed" },
      "/user/:id": {
        onrequest: async (req, res) => {
          await Promise.resolve();
          res.end(req.params.id);
          return true;
        },
      },
      "/redirect": { redirect: "/user/fixed" },
      "/page": { template: "<p>page</p>", headers: { "X-Route": "yes" } },
      "/throw": () => {
        throw new Error("internal secret");
      },
      "/reject": async () => {
        throw new Error("rejected secret");
      },
    },
  });
  assert.equal((await request(server.SERVER, "/user/fixed")).body, "fixed");
  assert.equal(
    (await request(server.SERVER, "/user/hello%20world")).body,
    "hello world",
  );
  assert.equal((await request(server.SERVER, "/redirect")).status, 302);
  assert.equal(
    (await request(server.SERVER, "/page")).headers["x-route"],
    "yes",
  );
  assert.equal((await request(server.SERVER, "/page")).headers["x-app"], "yes");
  for (const pathname of ["/throw", "/reject"]) {
    const response = await request(server.SERVER, pathname);
    assert.equal(response.status, 500);
    assert.doesNotMatch(response.body, /secret/);
  }
  assert.equal((await request(server.SERVER, "/user/%ZZ")).status, 400);
});
test("404 templates stay 404 and unavailable error pages have a fallback", async (t) => {
  const templated = await app(t, {
    routes: { "/404": { template: "<h1>missing</h1>" } },
  });
  assert.equal((await request(templated.SERVER, "/unknown")).status, 404);
  assert.match((await request(templated.SERVER, "/unknown")).body, /missing/);
  const fallback = await app(t, { errpage: "does-not-exist.html" });
  assert.equal(
    (await request(fallback.SERVER, "/missing.html")).body,
    "Not found",
  );
});
test("multiple static mounts and explicit file routes work", async (t) => {
  const server = await app(
    t,
    {
      staticRoots: { "/": "public", "/assets": "images" },
      routes: { "/custom": "custom.html" },
    },
    {
      "public/index.html": "public",
      "images/a.txt": "image fixture",
      "custom.html": "custom",
    },
  );
  assert.equal(
    (await request(server.SERVER, "/assets/a.txt")).body,
    "image fixture",
  );
  assert.equal((await request(server.SERVER, "/custom")).body, "custom");
});
test("server readiness rejects occupied ports and invalid certificates", async (t) => {
  const server = await app(t);
  await assert.rejects(
    serve({ host: "127.0.0.1", port: server.port, hotreload: true }),
    /EADDRINUSE/,
  );
  await assert.rejects(
    serve({
      protocol: "https",
      keypath: "missing-key",
      certpath: "missing-cert",
      hotreload: true,
    }),
    /ENOENT/,
  );
});
test("WebSocket shares HTTP listener, broadcasts errors and releases clients", async (t) => {
  const server = await app(t, { hotreload: 5000 });
  assert.match((await request(server.SERVER)).body, /hotreload/);
  const socket = new WebSocket(
    server.url.replace("http:", "ws:") + "/hotreload",
  );
  t.after(() => socket.terminate());
  await once(socket, "open");
  const received = once(socket, "message");
  server.SOCKETS.hotreload.broadcast({
    type: "error",
    message: "fixture error",
  });
  assert.equal(JSON.parse((await received)[0]).message, "fixture error");
  socket.close();
  await until(() => server.SOCKETS.hotreload.wss.clients.size === 0);
  await server.close();
  await server.close();
  assert.equal(server.SERVER.listening, false);
});
test("production disables reload, starts no watchers, and does not create project files", async (t) => {
  const server = await app(t, { production: true, root: "." });
  assert.doesNotMatch((await request(server.SERVER)).body, /hotreload/);
  assert.deepEqual(Object.keys(server.SOCKETS), []);
  await assert.rejects(fs.access(path.join(server.fixtureRoot, "favicon.ico")));
  await assert.rejects(
    fs.access(path.join(server.fixtureRoot, "manifest.webmanifest")),
  );
});
test("Python relay handshakes, forwards messages, reconnects and closes", async (t) => {
  const { WebSocketServer } = await import("ws");
  const backend = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(backend, "listening");
  const relay = new PythonRelay();
  let messages = [];
  relay.broadcast = (message) => messages.push(message.toString());
  const client = new PythonClient(
    { host: "127.0.0.1", protocol: "http", python: backend.address().port },
    relay,
  );
  t.after(async () => {
    await client.close();
    await relay.close();
    for (const socket of backend.clients) socket.terminate();
    await new Promise((resolve) => backend.close(resolve));
  });
  const [connection] = await once(backend, "connection");
  const [handshake] = await once(connection, "message");
  assert.equal(handshake.toString(), "nodejs");
  connection.send("from python");
  await until(() => messages.includes("from python"));
  const reconnect = once(backend, "connection");
  connection.close();
  await reconnect;
  await client.close();
});

test("file-route headers apply and shutdown drains only for its bounded timeout", async (t) => {
  const server = await app(t, {
    shutdownTimeout: 30,
    routes: {
      "/file": { path: "asset.txt", headers: { "X-File": "yes" } },
      "/slow": (req, res) => {
        res.write("started");
        return true;
      },
    },
  });
  assert.equal(
    (await request(server.SERVER, "/file")).headers["x-file"],
    "yes",
  );
  const response = await new Promise((resolve, reject) =>
    http
      .get({ host: "127.0.0.1", port: server.port, path: "/slow" }, resolve)
      .on("error", reject),
  );
  response.on("error", () => {});
  response.resume();
  const before = Date.now();
  await server.close();
  assert.ok(Date.now() - before < 1000);
});

test("SPA fallback handles deep HTML links while preserving missing assets and JSON errors", async (t) => {
  const server = await app(t, { spa: "index.html" });
  assert.equal(
    (
      await request(server.SERVER, "/dashboard/settings", {
        headers: { Accept: "text/html" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(server.SERVER, "/missing.js", {
        headers: { Accept: "text/html" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(server.SERVER, "/api/missing", {
        headers: { Accept: "application/json" },
      })
    ).status,
    404,
  );
});
test("API proxy forwards paths, queries, methods, bodies and headers and handles upstream errors", async (t) => {
  const backend = http.createServer((req, res) => {
    if (req.url === "/slow") {
      setTimeout(() => res.end("late"), 100);
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("X-Upstream", "yes");
      res.end(
        JSON.stringify({
          path: req.url,
          method: req.method,
          body,
          header: req.headers["x-proxy"],
        }),
      );
    });
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  t.after(() => new Promise((resolve) => backend.close(resolve)));
  const server = await app(t, {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:" + backend.address().port,
        stripPrefix: true,
        headers: { "X-Proxy": "fixture" },
      },
      "/wait": {
        target: "http://127.0.0.1:" + backend.address().port,
        stripPrefix: true,
        timeout: 10,
      },
      "/small": {
        target: "http://127.0.0.1:" + backend.address().port,
        maxBodyBytes: 2,
      },
      "/bad": "http://127.0.0.1:1",
    },
  });
  const response = await request(server.SERVER, "/api/item?q=a=b", {
    method: "POST",
    body: "hello",
  });
  assert.deepEqual(JSON.parse(response.body), {
    path: "/item?q=a=b",
    method: "POST",
    body: "hello",
    header: "fixture",
  });
  assert.equal(response.headers["x-upstream"], "yes");
  assert.equal((await request(server.SERVER, "/wait/slow")).status, 504);
  assert.equal(
    (
      await request(server.SERVER, "/small", {
        method: "POST",
        headers: { "Content-Length": "5" },
        body: "hello",
      })
    ).status,
    413,
  );
  assert.equal((await request(server.SERVER, "/bad")).status, 502);
});

test("invalid server settings fail before opening listeners", async () => {
  await assert.rejects(serve({ port: -1 }), /port must/);
  await assert.rejects(serve({ port: 0, host: "" }), /host must/);
  await assert.rejects(
    serve({ port: 0, proxy: { "/api": "file:///tmp/private" } }),
    /HTTP/,
  );
});
