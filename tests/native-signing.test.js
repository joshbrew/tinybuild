import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { packageNative } from "../tinybuild/native.js";
import { fixture } from "./helpers.js";
import {
  signatureCommand,
  verifyNativeSignature,
} from "../scripts/verify-native-signature.js";

test("signature checks use real OS verification tools and preserve filenames as data", async () => {
  const filename = path.resolve("app with spaces & symbols.exe");
  const calls = [];
  for (const platform of ["win32", "darwin", "linux"])
    assert.equal(
      (
        await verifyNativeSignature(filename, {
          platform,
          run: async (...args) => calls.push(args),
        })
      ).verified,
      true,
    );
  assert.equal(calls[0][0], "powershell.exe");
  assert.ok(!calls[0][1].at(-1).includes(filename));
  assert.equal(calls[0][2].env.TINYBUILD_VERIFY_FILE, filename);
  assert.equal(calls[1][0], "codesign");
  assert.equal(calls[1][1].at(-1), filename);
  assert.deepEqual(signatureCommand(filename, "linux").args, [
    "--verify",
    filename + ".asc",
    filename,
  ]);
  await assert.rejects(
    verifyNativeSignature(filename, {
      run: async () => {
        throw new Error("NotSigned");
      },
    }),
    /NotSigned/,
  );
});

test("release signing is followed by verification and a failed verification fails packaging", async (t) => {
  const cwd = await fixture(t, {
    "index.html": "app",
    "dist/index.js": "console.log(1);",
  });
  const configuration = {
    bundler: { outdir: "dist" },
    server: false,
    electron: { action: "package" },
    native: {
      signing: { command: ["node", "sign.js"], verify: ["node", "verify.js"] },
    },
  };
  const hooks = [];
  const result = await packageNative(configuration, [], {
    cwd,
    run: async () => {},
    sign: async (command, args, options) =>
      hooks.push({ command, args, options }),
  });
  assert.deepEqual(
    hooks.map((hook) => hook.args[0]),
    ["sign.js", "verify.js"],
  );
  assert.deepEqual(
    JSON.parse(hooks[1].options.env.TINYBUILD_ARTIFACT_DIRS),
    result.artifactDirectories,
  );
  await assert.rejects(
    packageNative(configuration, [], {
      cwd,
      run: async () => {},
      sign: async (command, args) => {
        if (args[0] === "verify.js") throw new Error("Signature invalid");
      },
    }),
    /Signature invalid/,
  );
  await fs.access(path.join(cwd, "electron/web/index.html"));
});
