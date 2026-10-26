import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { remotePlan, startRemote } from "../tinybuild/remote.js";
import { startTasks } from "../tinybuild/tasks.js";
import {
  verifyMacRelease,
  notarizeMac,
  macReleasePlan,
} from "../tinybuild/notarization.js";
import { checkMobileLifecycle } from "../tinybuild/mobile-smoke.js";
import { watchAppLifecycle } from "../tinybuild/client/native.js";
import { runTinybuild } from "../tinybuild/cli.js";
import { fixture, until } from "./helpers.js";

test("remote presets quote arguments for POSIX and Windows while forwarding only to loopback", () => {
  const plan = remotePlan({
    host: "user@mac-dev",
    directory: "/Users/dev/my app's source",
    command: ["npm", "run", "dev", "--", "argument;$(touch nope)"],
    forwards: [{ local: 8080, remote: 8081 }],
  });
  assert.ok(plan.args.includes("127.0.0.1:8080:127.0.0.1:8081"));
  assert.ok(plan.args.includes("BatchMode=yes"));
  assert.ok(plan.args.includes("ExitOnForwardFailure=yes"));
  assert.match(plan.args.at(-1), /exec 'npm' 'run' 'dev'/);
  assert.ok(plan.args.at(-1).includes("'argument;$(touch nope)'"));
  assert.ok(plan.args.at(-1).includes("'\\''"));
  const windows = remotePlan({
    host: "windows-dev",
    platform: "windows",
    directory: "C:\\My App's Folder",
    command: ["npm.cmd", "run", "dev", "--", "literal$arg;value"],
  });
  const script = Buffer.from(
    windows.args.at(-1).split(" ").at(-1),
    "base64",
  ).toString("utf16le");
  assert.ok(script.includes("C:\\My App''s Folder"));
  assert.ok(script.includes("'literal$arg;value'"));
  assert.ok(remotePlan({ host: "mac", command: false }).args.includes("-N"));
  for (const input of [
    { host: "-oProxyCommand=bad" },
    { host: "mac;echo" },
    { host: "mac", command: "npm start" },
    { host: "mac", port: 0 },
    { host: "mac", forwards: [{ local: 8080, remote: 0 }] },
    {
      host: "mac",
      forwards: [
        { local: 8080, remote: 8080 },
        { local: 8080, remote: 8000 },
      ],
    },
    { host: "mac", ready: { url: "http://remote.test" } },
  ])
    assert.throws(() => remotePlan(input));
});

test("remote launch uses task supervision and cleans up its real owned process", async (t) => {
  const cwd = await fixture(t, {
    "service.js": "console.log('REMOTE READY');setInterval(()=>{},10000);",
  });
  const app = await startRemote(
    { host: "test-host", command: ["npm", "start"] },
    {
      cwd,
      silent: true,
      supervise: async (tasks, options) => {
        assert.equal(tasks.remote.command, "ssh");
        return startTasks(
          {
            remote: {
              command: "node",
              args: ["service.js"],
              ready: { stdout: "REMOTE READY" },
            },
          },
          options,
        );
      },
    },
  );
  const pid = app.tasks.status.remote.pid;
  assert.ok(pid);
  await app.close();
  await app.close();
  await until(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  });
});

test("remote CLI dry runs do not build, scaffold or contact a host", async (t) => {
  const source =
    "export default {bundler:{entryPoints:['missing.js']},server:false,remotes:{mac:{host:'mac-dev',directory:'/Users/dev/app',command:['npm','start'],forwards:[{local:8080,remote:8080}]}}};";
  const cwd = await fixture(t, { "tinybuild.config.mjs": source });
  const result = await runTinybuild(["--remote", "mac", "--dryRun"], { cwd });
  assert.equal(result.dryRun, true);
  assert.equal(result.command, "ssh");
  assert.deepEqual(await fs.readdir(cwd), ["tinybuild.config.mjs"]);
  await assert.rejects(
    runTinybuild(["--remote", "unknown", "--dryRun"], { cwd }),
    /Unknown remote/,
  );
});

test("macOS release checks distinguish apps, disk images and installer packages", async () => {
  for (const extension of ["app", "dmg", "pkg"]) {
    const result = await verifyMacRelease("App with spaces." + extension, {
      dryRun: true,
      platform: "win32",
    });
    assert.equal(result.verified, false);
    assert.equal(result.commands[1][0], "xcrun");
    assert.ok(
      result.commands[2][1].includes(
        extension === "app"
          ? "execute"
          : extension === "pkg"
            ? "install"
            : "open",
      ),
    );
  }
  assert.equal(macReleasePlan("app.pkg")[0][0], "pkgutil");
  await assert.rejects(
    verifyMacRelease("app.app", { platform: "win32" }),
    /requires a Mac/,
  );
  assert.throws(() => macReleasePlan("app.zip"), /\.app/);
});

test("notarization requires explicit submission, checks acceptance before stapling and verifies the finished app", async (t) => {
  const cwd = await fixture(t, {
    "app.zip": "signed archive",
    "app.app": "signed app",
  });
  const input = {
    archive: path.join(cwd, "app.zip"),
    application: path.join(cwd, "app.app"),
    keychainProfile: "my-keychain-profile",
    platform: "darwin",
  };
  const planned = await notarizeMac({ ...input, dryRun: true });
  assert.equal(planned.commands.length, 5);
  assert.equal(planned.verified, false);
  let calls = [];
  const result = await notarizeMac({
    ...input,
    run: async (command, args) => {
      calls.push([command, args]);
      return {
        stdout: JSON.stringify({ status: "Accepted", id: "submission-id" }),
      };
    },
  });
  assert.equal(result.verified, true);
  assert.equal(result.submissionId, "submission-id");
  assert.equal(calls.length, 5);
  calls = [];
  await assert.rejects(
    notarizeMac({
      ...input,
      run: async (command, args) => {
        calls.push([command, args]);
        return { stdout: '{"status":"Invalid","id":"rejected"}' };
      },
    }),
    /not accepted/,
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    notarizeMac({ ...input, run: async () => ({ stdout: "not JSON" }) }),
    /JSON/,
  );
  await assert.rejects(
    verifyMacRelease(input.application, {
      platform: "darwin",
      run: async () => {
        throw Error("Signature invalid");
      },
    }),
    /Signature invalid/,
  );
});

function deviceRunner({ initial = true, failCheckpoint = false } = {}) {
  let granted = initial;
  const calls = [];
  return {
    calls,
    get granted() {
      return granted;
    },
    run: async (command, args) => {
      calls.push({ command, args });
      if (args.includes("dumpsys"))
        return { stdout: "android.permission.CAMERA: granted=" + granted };
      if (args.includes("grant")) granted = true;
      if (args.includes("revoke")) granted = false;
      if (args.includes("pidof")) return { stdout: "1234" };
      if (args.includes("--list"))
        return { stdout: "device tcp:8080 tcp:9000\n" };
      return { stdout: args.includes("launch") ? "com.example.app: 1234" : "" };
    },
  };
}

test("device checks cycle runtime permission states and restarts, restoring the original grants", async (t) => {
  const cwd = await fixture(t, { "app.apk": "apk" });
  for (const original of [true, false]) {
    const driver = deviceRunner({ initial: original });
    const checkpoints = [];
    const result = await checkMobileLifecycle({
      platform: "android",
      id: "com.example.app",
      artifact: path.join(cwd, "app.apk"),
      device: "test-device",
      permissions: ["android.permission.CAMERA"],
      relaunches: 2,
      reconnectPort: 8080,
      disconnectDelay: 0,
      run: driver.run,
      verify: async (value) => checkpoints.push(value),
    });
    assert.equal(result.checked, true);
    assert.equal(driver.granted, original);
    assert.deepEqual(
      checkpoints
        .filter((item) => item.phase === "permission")
        .map((item) => item.granted),
      [false, true],
    );
    assert.equal(
      checkpoints.filter((item) => item.phase === "relaunched").length,
      2,
    );
    assert.ok(driver.calls.some((item) => item.args.includes("--remove")));
    assert.ok(
      driver.calls.some(
        (item) =>
          item.args.at(-2) === "tcp:8080" && item.args.at(-1) === "tcp:9000",
      ),
    );
  }
});

test("Android checks background and resume the chosen app without force-stopping it", async (t) => {
  const cwd = await fixture(t, { "app.apk": "apk" }),
    driver = deviceRunner();
  const result = await checkMobileLifecycle({
    platform: "android",
    id: "com.example.app",
    device: "test",
    artifact: path.join(cwd, "app.apk"),
    backgrounds: 2,
    backgroundDelay: 0,
    relaunches: 0,
    run: driver.run,
  });
  assert.deepEqual(
    result.checkpoints.map((item) => item.phase),
    ["launched", "backgrounded", "resumed", "backgrounded", "resumed"],
  );
  assert.equal(
    driver.calls.filter((item) => item.args.includes("KEYCODE_HOME")).length,
    2,
  );
  assert.equal(
    driver.calls.some((item) => item.args.includes("force-stop")),
    false,
  );
});

test("background assertion failures restore the app to the foreground even after cancellation", async (t) => {
  const cwd = await fixture(t, { "app.apk": "apk" }),
    driver = deviceRunner({ initial: false }),
    abort = new AbortController(),
    calls = [];
  await assert.rejects(
    checkMobileLifecycle({
      platform: "android",
      id: "com.example.app",
      device: "test",
      artifact: path.join(cwd, "app.apk"),
      backgrounds: 1,
      backgroundDelay: 0,
      permissions: ["android.permission.CAMERA"],
      signal: abort.signal,
      run: async (command, args, settings) => {
        calls.push({ args, signal: settings.signal });
        return driver.run(command, args);
      },
      verify: async (item) => {
        if (item.phase === "backgrounded") {
          abort.abort();
          throw Error("background UI failed");
        }
      },
    }),
    /background UI failed/,
  );
  assert.equal(driver.granted, false);
  assert.ok(calls.at(-1).args.includes("pidof"));
  assert.equal(calls.at(-1).signal, undefined);
  for (const options of [
    { backgrounds: 21 },
    { backgrounds: -1 },
    { backgroundDelay: Infinity },
    { platform: "ios", backgrounds: 1 },
  ])
    await assert.rejects(
      checkMobileLifecycle(options),
      /background|Background/,
    );
});

test("device checks restore permission and USB settings when assertions fail or are cancelled", async (t) => {
  const cwd = await fixture(t, { "app.apk": "apk" });
  const abort = new AbortController();
  const driver = deviceRunner({ initial: false });
  await assert.rejects(
    checkMobileLifecycle({
      platform: "android",
      id: "com.example.app",
      artifact: path.join(cwd, "app.apk"),
      device: "test",
      permissions: ["android.permission.CAMERA"],
      reconnectPort: 8080,
      signal: abort.signal,
      run: driver.run,
      verify: async (detail) => {
        if (detail.phase === "disconnected") {
          abort.abort();
          throw Error("UI assertion failed");
        }
      },
    }),
    /UI assertion failed/,
  );
  assert.equal(driver.granted, false);
  assert.ok(driver.calls.some((item) => item.args.at(-1) === "tcp:9000"));
  await assert.rejects(
    checkMobileLifecycle({
      platform: "ios",
      permissions: ["android.permission.CAMERA"],
    }),
    /Android/,
  );
  await assert.rejects(
    checkMobileLifecycle({ permissions: ["bad permission;echo"] }),
    /permission names/,
  );
  const ios = await checkMobileLifecycle({
    platform: "ios",
    id: "com.example.app",
    artifact: "app.app",
    device: "sim",
    dryRun: true,
    hostPlatform: "win32",
  });
  assert.ok(ios.commands.some((item) => item[1].includes("terminate")));
  assert.equal(ios.checked, false);
});

test("lifecycle observers report browser and native state and remove late native subscriptions on close", async () => {
  const page = new EventTarget(),
    document = new EventTarget(),
    network = { onLine: true };
  document.visibilityState = "visible";
  const changes = [];
  let resolve,
    listener,
    removed = 0;
  const watcher = watchAppLifecycle({
    window: page,
    document,
    navigator: network,
    onChange: (state) => changes.push(state),
    nativeApp: {
      addListener: (event, callback) => {
        assert.equal(event, "appStateChange");
        listener = callback;
        return new Promise((done) => {
          resolve = done;
        });
      },
    },
  });
  network.onLine = false;
  page.dispatchEvent(new Event("offline"));
  assert.equal(changes.at(-1).online, false);
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(changes.at(-1).active, false);
  await Promise.resolve();
  listener({ isActive: true });
  assert.equal(changes.at(-1).reason, "native");
  assert.equal(changes.at(-1).active, true);
  const closing = watcher.close();
  resolve({
    remove: async () => {
      removed++;
    },
  });
  await closing;
  await watcher.close();
  assert.equal(removed, 1);
  const count = changes.length;
  page.dispatchEvent(new Event("online"));
  listener({ isActive: false });
  assert.equal(changes.length, count);
});
