import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { installNSIS } from "../scripts/installer-smoke.js";
import { fixture } from "./helpers.js";

async function setup(
  t,
  { leftovers = false, failInstall = false, failUninstall = false } = {},
) {
  const cwd = await fixture(t, { "setup.exe": "installer" });
  const directory = path.join(cwd, "installed app"),
    installer = path.join(cwd, "setup.exe"),
    calls = [];
  return {
    directory,
    installer,
    calls,
    executable: "app.exe",
    platform: "win32",
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === installer) {
        await fs.mkdir(directory);
        await fs.writeFile(path.join(directory, "app.exe"), "app");
        await fs.writeFile(
          path.join(directory, "uninstall.exe"),
          "uninstaller",
        );
        if (leftovers)
          await fs.writeFile(path.join(directory, "saved-data.txt"), "keep");
        if (failInstall) throw Error("installer failed");
      } else if (!failUninstall)
        await fs.unlink(path.join(directory, "app.exe"));
    },
  };
}

test("NSIS plans preserve spaced paths, run quietly and do not create files", async (t) => {
  const input = await setup(t);
  const plan = await installNSIS({ ...input, dryRun: true });
  assert.deepEqual(plan.commands[0], [
    input.installer,
    ["/S", "/D=" + input.directory],
  ]);
  assert.deepEqual(plan.commands[1][1], ["/S", "_?=" + input.directory]);
  await plan.close();
  assert.equal(input.calls.length, 0);
  await assert.rejects(fs.access(input.directory), { code: "ENOENT" });
});

test("NSIS checks installed files, uninstalls once and preserves leftover data", async (t) => {
  for (const leftovers of [false, true]) {
    const input = await setup(t, { leftovers }),
      abort = new AbortController();
    const app = await installNSIS({ ...input, signal: abort.signal });
    await fs.access(app.executable);
    abort.abort();
    await Promise.all([app.close(), app.close()]);
    assert.equal(input.calls.length, 2);
    assert.equal(input.calls[0].options.windowsVerbatimArguments, true);
    assert.equal(input.calls[0].options.argv0, '"' + input.installer + '"');
    assert.equal(
      input.calls[1].options.argv0,
      '"' + path.join(input.directory, "uninstall.exe") + '"',
    );
    assert.equal(
      input.calls[1].options.signal,
      undefined,
      "Cancellation must not prevent uninstall cleanup",
    );
    await assert.rejects(fs.access(app.executable), { code: "ENOENT" });
    if (leftovers)
      assert.equal(
        await fs.readFile(path.join(input.directory, "saved-data.txt"), "utf8"),
        "keep",
      );
    else await assert.rejects(fs.access(input.directory), { code: "ENOENT" });
  }
});

test("failed installs attempt their own uninstaller; failed uninstalls remain visible", async (t) => {
  const input = await setup(t, { failInstall: true });
  await assert.rejects(installNSIS(input), /installer failed/);
  assert.equal(input.calls.length, 2);
  await assert.rejects(fs.access(input.directory), { code: "ENOENT" });
  const broken = await setup(t, { failUninstall: true });
  const app = await installNSIS(broken);
  await assert.rejects(app.close(), /left the application/);
  await fs.access(path.join(broken.directory, "uninstall.exe"));
});

test("installer checks refuse existing destinations and unsafe plans before running commands", async (t) => {
  const input = await setup(t);
  await fs.mkdir(input.directory);
  await assert.rejects(installNSIS(input), /already exists/);
  for (const overrides of [
    { directory: path.parse(input.directory).root },
    { directory: input.directory + '"' },
    { executable: "../app.exe" },
    { installer: "relative.exe" },
    { executable: "app.js" },
  ])
    await assert.rejects(installNSIS({ ...input, ...overrides }), /Supply/);
  await assert.rejects(installNSIS({ ...input, platform: "linux" }), /Windows/);
  assert.equal(input.calls.length, 0);
});
