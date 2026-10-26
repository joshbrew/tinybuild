import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { serve } from "../tinybuild/node_server/server.js";
import {
  HotReloadClient,
  addHotReloadClient,
} from "../tinybuild/node_server/hotreload/hotreload.js";
import { fixture } from "./helpers.js";

test("reload socket_protocol overrides the scheme while the default follows the page URL", () => {
  for (const [pageProtocol, chosen, expected] of [
    ["http:", undefined, "ws:"],
    ["https:", undefined, "wss:"],
    ["http:", "wss", "wss:"],
  ]) {
    let url;
    const context = {
      URL,
      location: {
        href: pageProtocol + "//localhost:8080/",
        protocol: pageProtocol,
      },
      WebSocket: class {
        constructor(value) {
          url = value;
        }
        addEventListener() {}
      },
      window: { addEventListener() {} },
      document: {},
      addEventListener() {},
      setTimeout,
      clearTimeout,
      console,
    };
    vm.runInNewContext(
      "(" +
        HotReloadClient.toString() +
        ")('/hotreload','ws'," +
        JSON.stringify(chosen || null) +
        ")",
      context,
    );
    assert.ok(url.startsWith(expected + "//localhost:8080/"));
  }
  assert.ok(
    addHotReloadClient("<html>", "/hotreload", "ws", "wss").includes('"wss"'),
  );
  assert.equal(
    (
      addHotReloadClient("", "/hotreload", "</script>", "</script>").match(
        /<\/script>/g,
      ) || []
    ).length,
    1,
    "Injected settings cannot close their script element",
  );
});

test("Python relays support an explicit separate port and release both listeners on shutdown", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, { "index.html": "app" });
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  t.after(async () => {
    for (const client of upstream.clients) client.terminate();
    await new Promise((resolve) => upstream.close(resolve));
  });
  await once(upstream, "listening");
  const connected = once(upstream, "connection");
  app = await serve({
    cwd,
    host: "127.0.0.1",
    port: 0,
    python: upstream.address().port,
    python_node: 0,
    hotreload: false,
  });
  const [backend] = await connected;
  assert.notEqual(app.python_node, app.port);
  const client = new WebSocket("ws://127.0.0.1:" + app.python_node + "/");
  t.after(() => client.terminate());
  await once(client, "open");
  const received = once(client, "message");
  backend.send("relay works");
  assert.equal((await received)[0].toString(), "relay works");
  await app.close();
  assert.equal(app.SERVER.listening, false);
  assert.equal(app.SOCKETS.python.server.listening, false);
});
