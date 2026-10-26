import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, renameForEditorSave } from "./helpers.js";

for (const code of ["EPERM", "EACCES", "EBUSY"]) {
  test(`editor saves retry transient Windows ${code} without removing the existing file`, async (t) => {
    const cwd = await fixture(t, { "part.js": "old", "part.js.tmp": "new" });
    const source = path.join(cwd, "part.js.tmp"),
      target = path.join(cwd, "part.js");
    let calls = 0;
    const waits = [];
    const result = await renameForEditorSave(source, target, {
      platform: "win32",
      wait: async (milliseconds) => waits.push(milliseconds),
      rename: async (from, to) => {
        assert.equal(from, source);
        assert.equal(to, target);
        assert.equal(await fs.readFile(target, "utf8"), "old");
        if (++calls < 3)
          throw Object.assign(new Error("reader holds file"), { code });
        return "renamed";
      },
    });
    assert.equal(calls, 3);
    assert.equal(result, "renamed");
    assert.equal(waits.length, 2);
    assert.ok(waits.every((milliseconds) => milliseconds > 0));
    // Only the supplied rename operation may replace or remove these files.
    assert.equal(await fs.readFile(target, "utf8"), "old");
    assert.equal(await fs.readFile(source, "utf8"), "new");
  });
}

test("editor saves replace a real file atomically and remove the temporary source", async (t) => {
  const cwd = await fixture(t, { "part.js": "old", "part.js.tmp": "new" });
  const source = path.join(cwd, "part.js.tmp"),
    target = path.join(cwd, "part.js");
  await renameForEditorSave(source, target);
  assert.equal(await fs.readFile(target, "utf8"), "new");
  await assert.rejects(fs.access(source), { code: "ENOENT" });
});

test("persistent Windows rename failures stop retrying and retain both files", async (t) => {
  const cwd = await fixture(t, { "part.js": "old", "part.js.tmp": "new" });
  const denied = Object.assign(new Error("permanent permission failure"), {
    code: "EPERM",
  });
  let calls = 0,
    waited = 0;
  await assert.rejects(
    renameForEditorSave(
      path.join(cwd, "part.js.tmp"),
      path.join(cwd, "part.js"),
      {
        platform: "win32",
        wait: async (milliseconds) => {
          waited += milliseconds;
        },
        rename: async () => {
          calls++;
          throw denied;
        },
      },
    ),
    (error) => error === denied,
  );
  assert.ok(calls > 1 && calls <= 10, "Retries must be bounded");
  assert.ok(
    waited > 0 && waited <= 1000,
    "Backoff must stay within one second",
  );
  assert.equal(await fs.readFile(path.join(cwd, "part.js"), "utf8"), "old");
  assert.equal(await fs.readFile(path.join(cwd, "part.js.tmp"), "utf8"), "new");
});

test("editor saves propagate unrelated errors and non-Windows permission failures immediately", async () => {
  for (const [platform, code] of [
    ["win32", "ENOENT"],
    ["win32", "ENOSPC"],
    ["linux", "EPERM"],
    ["darwin", "EACCES"],
  ]) {
    const failure = Object.assign(new Error("rename failed"), { code });
    let calls = 0;
    await assert.rejects(
      renameForEditorSave("source", "destination", {
        platform,
        rename: async () => {
          calls++;
          throw failure;
        },
        wait: async () => assert.fail("This error must not be retried"),
      }),
      (error) => error === failure,
    );
    assert.equal(calls, 1);
  }
});
