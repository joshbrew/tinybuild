import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { checkTauriUI } from "../scripts/check-native-ui.js";

test("Tauri UI check exercises WebDriver rendering and clicks, then releases its session", async () => {
  const calls = [];
  let clicked = false;
  const application = path.resolve("app with spaces");
  const result = await checkTauriUI({
    application,
    request: async (url, options) => {
      const body = options.body && JSON.parse(options.body);
      calls.push({ path: url.pathname, ...options, body });
      let value;
      if (url.pathname === "/session") value = { sessionId: "owned/session" };
      else if (url.pathname.endsWith("/execute/sync"))
        value = "Desktop count: " + Number(clicked);
      else if (url.pathname.endsWith("/element"))
        value = { "element-6066-11e4-a52e-4f735466cecf": "button-id" };
      else if (url.pathname.endsWith("/click")) clicked = true;
      return { ok: true, json: async () => ({ value }) };
    },
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(calls[0].body.capabilities.alwaysMatch["tauri:options"], {
    application,
  });
  assert.equal(clicked, true);
  assert.equal(calls.at(-1).method, "DELETE");
  assert.equal(calls.at(-1).path, "/session/owned%2Fsession");
});

test("Tauri UI check reports driver errors and still closes an established session", async () => {
  const calls = [];
  await assert.rejects(
    checkTauriUI({
      application: path.resolve("app"),
      request: async (url, options) => {
        calls.push(options.method);
        const value =
          url.pathname === "/session"
            ? { sessionId: "owned" }
            : options.method === "DELETE"
              ? null
              : { error: "no such window", message: "Window closed" };
        return { ok: true, json: async () => ({ value }) };
      },
    }),
    /Window closed/,
  );
  assert.equal(calls.at(-1), "DELETE");
  await assert.rejects(
    checkTauriUI({ application: "relative/app" }),
    /absolute/,
  );
  await assert.rejects(
    checkTauriUI({
      application: path.resolve("app"),
      endpoint: "file:///tmp/driver",
    }),
    /HTTP/,
  );
});
