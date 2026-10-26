import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  nativeApp,
  resolveNativeConfig,
  selectNativeProfile,
  applyNativePermissions,
  applyNativeMetadata,
} from "../tinybuild/native-config.js";
import { packageNative } from "../tinybuild/native.js";
import {
  developmentURLs,
  discoverDevices,
  developmentQR,
} from "../tinybuild/devices.js";
import { analyzeBuild, benchmarkBuild } from "../tinybuild/diagnostics.js";
import { bundle } from "../tinybuild/esbuild/bundler.js";
import { packager } from "../tinybuild/packager.js";
import { fixture } from "./helpers.js";

test("native profiles expand target macros, switch variants without leaking debug plugins, and preserve inputs", () => {
  const definition = {
    id: "com.example.demo",
    name: "Demo",
    version: "1.2.3",
    targets: { electron: { action: "stage" } },
    profiles: {
      debug: { name: "Demo Debug", plugins: [{ name: "debug-plugin" }] },
      release: {
        targets: {
          electron: { action: "package" },
          mobile: { android: "build" },
        },
      },
    },
    profile: "debug",
  };
  const before = JSON.stringify(definition);
  const config = nativeApp(definition);
  assert.equal(config.native.name, "Demo Debug");
  assert.deepEqual(resolveNativeConfig(config), config);
  const release = selectNativeProfile(config, "release");
  assert.equal(release.native.name, "Demo");
  assert.deepEqual(release.native.plugins, []);
  assert.equal(release.electron.action, "package");
  assert.equal(release.mobile.android, "build");
  assert.equal(JSON.stringify(definition), before);
  assert.throws(() => nativeApp({ id: "invalid/id" }), /identifier/);
  assert.throws(() => nativeApp({ version: "bad" }), /semantic/);
  assert.throws(() => nativeApp({ buildNumber: 0 }), /positive integer/);
  assert.throws(
    () => selectNativeProfile(config, "missing"),
    /Unknown native profile/,
  );
});

test("native staging generates shared identity, runtime icons, permissions and config overlays without running SDKs", async (t) => {
  const root = await fixture(t, {
    "index.html": "<h1>Native</h1>",
    "dist/index.js": "console.log(1)",
    "icon.png": "icon",
    "android/app/src/main/AndroidManifest.xml":
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>',
    "ios/App/App/Info.plist":
      "<plist><dict><key>Keep</key><string>yes</string></dict></plist>",
  });
  const config = {
    ...nativeApp({
      id: "com.example.native",
      name: "Shared App",
      version: "2.0.0",
      icons: { electron: "icon.png", tauri: ["icon.png"] },
      devUrl: true,
      permissions: {
        android: ["android.permission.CAMERA"],
        ios: { NSCameraUsageDescription: "Take a photo & save it" },
        tauri: ["core:default"],
      },
      targets: {
        electron: { action: "stage" },
        tauri: { action: "stage" },
        mobile: { android: "stage", ios: "stage" },
      },
    }),
    bundler: { outdir: "dist" },
  };
  const result = await packageNative(config, [], {
    cwd: root,
    devUrl: "http://192.0.2.10:8080",
    run: async () => {
      throw new Error("Stage invoked an SDK");
    },
  });
  assert.deepEqual(result.commands, []);
  const cap = JSON.parse(
    await fs.readFile(result.config.capacitorFile, "utf8"),
  );
  assert.equal(cap.appId, "com.example.native");
  assert.equal(cap.server.url, "http://192.0.2.10:8080");
  const tauri = JSON.parse(await fs.readFile(result.config.tauriFile, "utf8"));
  assert.equal(tauri.productName, "Shared App");
  const electron = JSON.parse(
    await fs.readFile(path.join(root, "electron/tinybuild-app.json"), "utf8"),
  );
  assert.equal(
    await fs.readFile(path.join(root, "electron", electron.icon), "utf8"),
    "icon",
  );
  const plist = await fs.readFile(
    path.join(root, "ios/App/App/Info.plist"),
    "utf8",
  );
  assert.match(plist, /Take a photo &amp; save it/);
  assert.match(plist, /<key>Keep<\/key>/);
  await applyNativePermissions(config.native, root);
  assert.equal(
    (
      await fs.readFile(
        path.join(root, "android/app/src/main/AndroidManifest.xml"),
        "utf8",
      )
    ).match(/uses-permission/g).length,
    1,
  );
  assert.equal(
    await fs.readFile(path.join(root, "ios/App/App/Info.plist"), "utf8"),
    plist,
  );
  await assert.rejects(
    applyNativePermissions(
      { permissions: { android: ['bad"permission'] } },
      root,
    ),
    /Invalid Android permission/,
  );
});

test("release plans include identifiers, device targets and signing hooks; required credentials are checked without serializing values", async (t) => {
  const root = await fixture(t, {
    "index.html": "Native",
    "dist/index.js": "1;",
    "icons/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  const config = {
    ...nativeApp({
      id: "com.example.release",
      name: "Release",
      version: "1.0.0",
      icons: { mobile: "icons" },
      env: { TINYBUILD_TEST_SIGN: "private-value" },
      signing: {
        requiredEnv: ["TINYBUILD_TEST_SIGN"],
        command: ["sign-tool", "release"],
      },
      targets: {
        electron: { action: "package", arch: "x64" },
        mobile: { android: { action: "run", target: "emulator-5554" } },
      },
    }),
    bundler: { outdir: "dist" },
  };
  const plan = await packageNative(config, [], { cwd: root, dryRun: true });
  assert.ok(plan.commands[0].includes("--app-bundle-id"));
  assert.ok(
    plan.commands.some(
      (args) => args.join(" ") === "cap run android --target emulator-5554",
    ),
  );
  assert.deepEqual(plan.commands.at(-1), ["sign-tool", "release"]);
  assert.ok(
    plan.commands.some(
      (args) => args[0] === "capacitor-assets" && args.includes("--android"),
    ),
  );
  assert.doesNotMatch(JSON.stringify(plan), /private-value/);
  let signed = false;
  await packageNative({ ...config, mobile: false }, [], {
    cwd: root,
    run: async () => {},
    sign: async (command, args, options) => {
      assert.equal(command, "sign-tool");
      assert.equal(options.env.TINYBUILD_TEST_SIGN, "private-value");
      signed = true;
    },
  });
  assert.equal(signed, true);
  const unsigned = {
    ...config,
    native: {
      ...config.native,
      signing: { requiredEnv: ["TINYBUILD_NEVER_SET_CREDENTIAL"] },
    },
  };
  await assert.rejects(
    packageNative(unsigned, [], {
      cwd: root,
      run: async () => assert.fail("Must check signing before commands"),
    }),
    /Missing signing environment/,
  );
});

test("device discovery handles SDK paths, offline/unauthorized devices, simulators and missing tools", async () => {
  const calls = [];
  const found = await discoverDevices({
    platform: "darwin",
    sdk: "/SDK folder",
    run: async (command, args) => {
      calls.push([command, args]);
      return {
        stdout: command.endsWith("adb")
          ? "List of devices attached\nphone device model:Pixel_9\nblocked unauthorized\ngone offline\n"
          : command.endsWith("emulator")
            ? "Pixel_API_35\n"
            : JSON.stringify({
                devices: {
                  runtime: [{ name: "iPhone", udid: "sim-1", state: "Booted" }],
                },
              }),
      };
    },
  });
  assert.equal(found.android.length, 3);
  assert.equal(found.android[1].status, "unauthorized");
  assert.equal(found.emulators[0], "Pixel_API_35");
  assert.equal(found.ios[0].id, "sim-1");
  assert.equal(calls[0][0], path.join("/SDK folder", "platform-tools", "adb"));
  const missing = await discoverDevices({
    platform: "win32",
    run: async () => {
      throw new Error("Not installed");
    },
  });
  assert.equal(missing.errors.length, 2);
  assert.deepEqual(missing.ios, []);
});

test("LAN URLs preserve paths/ports, omit loopback interfaces and generate a real QR SVG", async () => {
  const urls = developmentURLs("http://0.0.0.0:8081/app?debug=1", {
    interfaces: {
      lo: [{ internal: true, family: "IPv4", address: "127.0.0.1" }],
      wifi: [
        { internal: false, family: "IPv4", address: "192.0.2.20" },
        { internal: false, family: "IPv4", address: "192.0.2.20" },
      ],
    },
  });
  assert.deepEqual(urls, ["http://192.0.2.20:8081/app?debug=1"]);
  assert.equal(
    developmentURLs("https://localhost:444/", { host: "2001:db8::1" })[0],
    "https://[2001:db8::1]:444/",
  );
  assert.match(await developmentQR(urls[0]), /<svg[^>]*viewBox/);
});

test("build reports expose dependencies, portable HTML bytes, budgets and rebuild reasons", async (t) => {
  const root = await fixture(t, {
    "index.js": 'import { value } from "./value.js"; console.log(value);',
    "value.js": "export const value=42;",
  });
  const config = {
    absWorkingDir: root,
    entryPoints: ["index.js"],
    outfile: "dist/index",
    bundleHTML: true,
    autoInstall: false,
  };
  const results = await bundle(config);
  const report = await analyzeBuild(results, {
    cwd: root,
    budgets: { totalBytes: 1 },
  });
  assert.ok(
    report.inputs.some(
      (input) =>
        input.path === "index.js" &&
        input.imports.some((item) => item.path === "value.js"),
    ),
  );
  assert.ok(report.outputs.some((output) => output.target === "html"));
  assert.equal(
    report.outputBytes,
    report.outputs.reduce((sum, output) => sum + output.bytes, 0),
  );
  await assert.rejects(
    analyzeBuild(results, {
      cwd: root,
      budgets: { entryBytes: 1, onExceed: "error" },
    }),
    /Build budget exceeded/,
  );
  const warnings = [];
  const app = await packager(
    { build: true, server: false, bundler: config, budgets: { totalBytes: 1 } },
    { onWarning: (warning) => warnings.push(warning) },
  );
  await fs.writeFile(path.join(root, "value.js"), "export const value=84;");
  await app.rebuild(["value.js"]);
  assert.deepEqual(app.stats.reason, { type: "files", files: ["value.js"] });
  assert.equal(warnings.length, 2);
  await app.close();
  await assert.rejects(
    packager({
      build: true,
      server: false,
      bundler: config,
      budgets: { totalBytes: 1, onExceed: "error" },
    }),
    /Build budget exceeded/,
  );
});

test("cold/warm benchmarks build real outputs and dispose their persistent contexts", async (t) => {
  const root = await fixture(t, { "index.js": "console.log(42);" });
  const report = await benchmarkBuild(
    {
      absWorkingDir: root,
      entryPoints: ["index.js"],
      outfile: "dist/index",
      autoInstall: false,
    },
    { iterations: 2, warmup: 1 },
  );
  assert.equal(report.cold.samples.length, 2);
  assert.equal(report.warm.samples.length, 2);
  assert.ok(report.warm.meanMs >= 0);
  assert.match(
    await fs.readFile(path.join(root, "dist/index.js"), "utf8"),
    /42/,
  );
  await assert.rejects(benchmarkBuild({}, { iterations: 0 }), /iterations/);
});

test("mobile metadata updates known version/name fields and preserves platform customizations", async (t) => {
  const root = await fixture(t, {
    "android/app/build.gradle":
      'versionCode 1\nversionName "1.0.0"\ncustomSetting true',
    "android/app/build.gradle.kts": 'versionCode = 1\nversionName = "1.0.0"',
    "android/app/src/main/res/values/strings.xml":
      '<resources><string name="app_name">Old</string><string name="keep">Custom</string></resources>',
    "ios/App/App/Info.plist":
      "<plist><dict><key>CFBundleShortVersionString</key><string>1.0.0</string><key>CFBundleVersion</key><string>1</string><key>CFBundleDisplayName</key><string>Old</string><key>Keep</key><true/></dict></plist>",
  });
  await applyNativeMetadata(
    { name: "New & Improved", version: "2.1.0", buildNumber: 12 },
    root,
  );
  assert.match(
    await fs.readFile(path.join(root, "android/app/build.gradle"), "utf8"),
    /versionCode 12\nversionName "2.1.0"\ncustomSetting true/,
  );
  assert.match(
    await fs.readFile(path.join(root, "android/app/build.gradle.kts"), "utf8"),
    /versionCode = 12/,
  );
  const strings = await fs.readFile(
    path.join(root, "android/app/src/main/res/values/strings.xml"),
    "utf8",
  );
  assert.match(strings, /New &amp; Improved/);
  assert.match(strings, /Custom/);
  const plist = await fs.readFile(
    path.join(root, "ios/App/App/Info.plist"),
    "utf8",
  );
  assert.match(plist, /<string>12<\/string>/);
  assert.match(plist, /<key>Keep<\/key><true\/>/);
});

test("custom Capacitor configs are preserved and macro integration is explicit before SDK commands", async (t) => {
  const root = await fixture(t, {
    "index.html": "Native",
    "dist/index.js": "1;",
    "capacitor.config.ts":
      'export default {appId:"com.existing.app",custom:true};',
  });
  const config = {
    ...nativeApp({
      id: "com.example.app",
      targets: { mobile: { android: "stage" } },
    }),
    bundler: { outdir: "dist" },
  };
  const staged = await packageNative(config, [], { cwd: root });
  assert.equal(staged.config.manualConfig.length, 1);
  assert.match(
    await fs.readFile(path.join(root, "capacitor.config.ts"), "utf8"),
    /custom:true/,
  );
  await assert.rejects(
    packageNative({ ...config, mobile: { android: "run" } }, [], {
      cwd: root,
      run: async () =>
        assert.fail("Must validate integration before installing"),
    }),
    /Merge .*native-capacitor/,
  );
});

test("CLI publishes device links before opening native tools and abort tears down the owned server/tasks", async (t) => {
  const { runTinybuild } = await import("../tinybuild/cli.js");
  const root = await fixture(t, {
    "tinybuild.config.mjs": "export default {};",
    "index.html": "Native",
    "index.js": "1;",
  });
  const abort = new AbortController();
  let announced;
  t.mock.method(console, "log", () => {});
  await assert.rejects(
    runTinybuild(
      {
        bundler: {
          entryPoints: ["index.js"],
          outfile: "dist/index",
          autoInstall: false,
        },
        server: { port: 0, hotreload: false },
        qr: true,
        native: {
          id: "com.example.app",
          devUrl: true,
          devHost: "192.0.2.25",
          targets: { electron: { action: "open" } },
        },
        tasks: {
          backend: {
            command: "node",
            args: ["-e", 'console.log("READY");setInterval(()=>{},1000)'],
            ready: { stdout: "READY" },
          },
        },
      },
      {
        cwd: root,
        signal: abort.signal,
        tasks: { silent: true },
        network: { host: "192.0.2.25" },
        onReady: (app) => {
          announced = app;
        },
        native: {
          run: async (args, options) => {
            if (args[0] === "install") return;
            assert.ok(announced.lanURLs[0].startsWith("http://192.0.2.25:"));
            assert.match(
              await fs.readFile(
                path.join(root, ".tinybuild/dev-qr.svg"),
                "utf8",
              ),
              /<svg/,
            );
            await new Promise((_, reject) => {
              options.signal.addEventListener(
                "abort",
                () => reject(new Error("Native command cancelled")),
                { once: true },
              );
              abort.abort();
            });
          },
        },
      },
    ),
    /Native command cancelled/,
  );
  assert.equal(announced.server.SERVER.listening, false);
  assert.equal(announced.tasks.status.backend.state, "stopped");
});

test("Tauri plugins are planned once, stay inactive during staging and cannot auto-install in frozen mode", async (t) => {
  const root = await fixture(t, {
    "index.html": "Native",
    "dist/index.js": "1;",
  });
  const config = {
    ...nativeApp({
      id: "com.example.app",
      plugins: [{ target: "tauri", name: "fs" }],
      targets: { tauri: { action: "dev" } },
    }),
    bundler: { outdir: "dist" },
  };
  const plan = await packageNative(config, [], { cwd: root, dryRun: true });
  assert.deepEqual(plan.commands[0], ["tauri", "add", "fs"]);
  assert.ok(plan.commands.at(-1).includes("--config"));
  const staged = await packageNative(
    { ...config, tauri: { action: "stage" } },
    [],
    { cwd: root },
  );
  assert.deepEqual(staged.commands, []);
  await assert.rejects(
    packageNative({ ...config, frozen: true }, [], { cwd: root, dryRun: true }),
    /plugin missing in frozen/,
  );
  const cargo = path.join(root, "src-tauri/Cargo.toml");
  await fs.writeFile(
    cargo,
    (await fs.readFile(cargo, "utf8")).replace(
      "[dependencies]",
      '[dependencies]\ntauri-plugin-fs = "2"',
    ),
  );
  await fs.mkdir(path.join(root, "node_modules/@tauri-apps/plugin-fs"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "node_modules/@tauri-apps/plugin-fs/package.json"),
    '{"main":"index.js"}',
  );
  await fs.writeFile(
    path.join(root, "node_modules/@tauri-apps/plugin-fs/index.js"),
    "",
  );
  const installed = await packageNative(config, [], {
    cwd: root,
    dryRun: true,
  });
  assert.ok(!installed.commands.some((args) => args[1] === "add"));
  await assert.rejects(
    packageNative({ ...config, mobile: { android: "typo" } }, [], {
      cwd: root,
    }),
    /Unknown mobile action/,
  );
});

test("Electron makers build distributions in the shell directory with runtime plugins and preserve custom Forge config", async (t) => {
  const root = await fixture(t, { "index.html": "App", "dist/index.js": "1;" });
  const config = {
    ...nativeApp({
      id: "com.example.install",
      author: "Example Team",
      plugins: [{ target: "electron", name: "bufferutil", version: "^4.0.0" }],
      targets: {
        electron: {
          action: "make",
          makers: [
            {
              name: "@electron-forge/maker-squirrel",
              config: { name: "Example" },
            },
          ],
          arch: "x64",
        },
      },
    }),
    bundler: { outdir: "dist" },
  };
  const plan = await packageNative(config, [], { cwd: root, dryRun: true });
  assert.deepEqual(plan.commands.at(-1), [
    "electron-forge",
    "make",
    "--arch",
    "x64",
  ]);
  assert.equal(plan.invocations.at(-1).cwd, path.join(root, "electron"));
  const pkgFile = path.join(root, "electron/package.json");
  const pkg = JSON.parse(await fs.readFile(pkgFile, "utf8"));
  assert.equal(pkg.dependencies.bufferutil, "^4.0.0");
  assert.equal(pkg.author, "Example Team");
  assert.equal(pkg.devDependencies.electron, "^44.8.0");
  assert.ok(pkg.devDependencies["@electron-forge/maker-squirrel"]);
  assert.match(
    await fs.readFile(path.join(root, "electron/tinybuild-forge.cjs"), "utf8"),
    /com.example.install/,
  );
  pkg.config.forge = "./custom-forge.cjs";
  await fs.writeFile(pkgFile, JSON.stringify(pkg));
  await packageNative({ ...config, electron: { action: "make" } }, [], {
    cwd: root,
    dryRun: true,
  });
  assert.equal(
    JSON.parse(await fs.readFile(pkgFile, "utf8")).config.forge,
    "./custom-forge.cjs",
  );
  await assert.rejects(
    packageNative({ ...config, frozen: true }, [], {
      cwd: root,
      run: async () => assert.fail("Frozen make cannot install"),
    }),
    /missing in frozen|installed shell dependencies/,
  );
});
