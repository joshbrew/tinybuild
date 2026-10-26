import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture } from "./helpers.js";
import {
  platformFile,
  platformOptions,
  mirrorGuestFile,
} from "../scripts/check-platform.js";

test("guest copies preserve native templates and omit host dependencies and generated SDK trees", () => {
  for (const filename of [
    "tinybuild/templates/src-tauri/Cargo.toml",
    "tinybuild/templates/src-tauri/src/main.rs",
    "tinybuild/templates/electron_app.js",
    "examples/desktop_debug/tinybuild.config.js",
    "tests/tsconfig-template.test.js",
    "scripts/check-platform.js",
    "package-lock.json",
    "img/esbuild.svg",
    "catgnome.png",
  ])
    assert.equal(platformFile(filename), true, filename);
  for (const filename of [
    "node_modules/esbuild/bin/esbuild",
    "examples/native_profiles/node_modules/electron/path.txt",
    "examples/native_profiles/src-tauri/target/release/app",
    "examples/native_profiles/electron/web/index.html",
    "examples/default/dist/index.js",
    "examples/default/.env.production",
    ".test-platform/tools/node/bin/node",
    ".git/config",
    "examples/desktop_debug/credentials.key",
  ])
    assert.equal(platformFile(filename), false, filename);
});

test("guest development mirrors additions, edits and removals without touching outside paths", async (t) => {
  const cwd = await fixture(t, {
    "host/nested/app.js": "first",
    "host/.env": "private",
    "outside.js": "outside",
  });
  const original = path.join(cwd, "host");
  const working = path.join(cwd, "guest");
  const source = path.join(original, "nested/app.js");
  const target = path.join(working, "nested/app.js");
  await mirrorGuestFile(original, working, "add", source);
  assert.equal(await fs.readFile(target, "utf8"), "first");
  await fs.writeFile(source, "second");
  await mirrorGuestFile(original, working, "change", source);
  assert.equal(await fs.readFile(target, "utf8"), "second");
  await mirrorGuestFile(original, working, "add", path.join(original, ".env"));
  await assert.rejects(fs.access(path.join(working, ".env")));
  await mirrorGuestFile(
    original,
    working,
    "unlink",
    path.join(cwd, "outside.js"),
  );
  assert.equal(
    await fs.readFile(path.join(cwd, "outside.js"), "utf8"),
    "outside",
  );
  await fs.unlink(source);
  await mirrorGuestFile(original, working, "unlink", source);
  await assert.rejects(fs.access(target));
  await mirrorGuestFile(
    original,
    working,
    "unlinkDir",
    path.join(original, "nested"),
  );
  await assert.rejects(fs.access(path.dirname(target)));
});

test("cross-platform runner validates suite, example, port and distribution arguments", () => {
  assert.deepEqual(platformOptions(), {
    suite: "core",
    example: "desktop_debug",
    port: 8080,
    distribution: "Ubuntu",
    host: "127.0.0.1",
  });
  assert.equal(
    platformOptions({ suite: "dev", port: 0, distribution: "Ubuntu-24.04" })
      .port,
    0,
  );
  for (const options of [
    { suite: "unknown" },
    { example: "../outside" },
    { example: "app;echo" },
    { port: -1 },
    { port: 65536 },
    { port: 1.5 },
    { distribution: "--exec" },
    { distribution: "Ubuntu;echo" },
    { host: "other-host" },
  ])
    assert.throws(() => platformOptions(options));
});
