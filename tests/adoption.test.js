import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixture, until } from "./helpers.js";
import { runTinybuild, doctor } from "../tinybuild/cli.js";
import { packager } from "../tinybuild/packager.js";
import { checkProject } from "../tinybuild/project-check.js";
import { optionReference } from "../tinybuild/option-reference.js";
import {
  initStarter,
  listStarters,
  addAgentGuide,
} from "../tinybuild/starters.js";
import { loadConfig } from "../tinybuild/config.js";
import { syncOptionReference } from "../scripts/sync-option-reference.js";
import { syncStarters } from "../scripts/sync-starters.js";
import { validateChecks } from "../tinybuild/checks-config.js";
import { bundleTypes } from "../tinybuild/esbuild/bundler.js";
const execute = promisify(execFile);
const cli = fileURLToPath(
  new URL("../tinybuild/bin/global.js", import.meta.url),
);

test("option help and editor documentation stay in sync with annotated explanations and types", async () => {
  const worker = optionReference("worker");
  assert.ok(worker.some((item) => item.path === "bundler.blobWorkers"));
  assert.equal(
    optionReference("server.port").find((item) => item.path === "server.port")
      .type,
    "number",
  );
  assert.match(
    optionReference("budgets.totalBytes")[0].description,
    /Maximum combined size/,
  );
  assert.equal(optionReference("sourcemap")[0].default, false);
  assert.ok(optionReference().length > 100);
  assert.equal(
    optionReference().some((item) =>
      /BUILD|BUDGETS|SERVER|\.mac$/.test(item.path),
    ),
    false,
  );
  assert.match(
    optionReference("bundler.minifyWhitespace")[0].description,
    /Remove spaces/,
  );
  assert.equal(await syncOptionReference({ check: true }), false);
});

test("JSON inspection results are versioned, noninteractive, searchable and do not scaffold", async (t) => {
  const cwd = await fixture(t);
  for (const args of [
    ["options", "--search", "worker"],
    ["init", "--list", "--search", "worker"],
    ["doctor"],
    ["preview"],
  ]) {
    const { stdout } = await execute(
      process.execPath,
      [cli, ...args, "--json"],
      { cwd },
    );
    const result = JSON.parse(stdout);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.ok, true);
    assert.ok(result.data);
  }
  assert.deepEqual(await fs.readdir(cwd), []);
});

test("JSON errors exit nonzero and previews explain CLI origins and production defaults", async (t) => {
  const cwd = await fixture(t, {
    "tinybuild.config.mjs":
      "export default {server:{port:8088},bundler:false};",
  });
  const { stdout } = await execute(
    process.execPath,
    [cli, "preview", "--production", "--port", "8099", "--json"],
    { cwd },
  );
  const data = JSON.parse(stdout).data;
  assert.ok(
    data.explanations.some(
      (item) => item.path === "server.port" && item.source === "CLI override",
    ),
  );
  assert.match(
    data.explanations.find((item) => item.path === "server.root").reason,
    /production uses dist/,
  );
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default {unknownSetting:true};",
  );
  await assert.rejects(
    execute(process.execPath, [cli, "validate", "--strict", "--json"], { cwd }),
    (error) => {
      const result = JSON.parse(error.stdout);
      assert.equal(error.code, 1);
      assert.equal(result.ok, false);
      assert.match(result.error.message, /unknownSetting/);
      return true;
    },
  );
});

test("CLI error output follows parsed JSON flags and reports the actual command", async (t) => {
  const cwd = await fixture(t, {
    "tinybuild.config.mjs": "export default {unknownSetting:true};",
  });
  const cases = [
    { args: ["--validate", "--strict", "--json"], json: true },
    { args: ["validate", "--strict", "--json", "false"], json: false },
    { args: ["validate", "--strict", "--json=false"], json: false },
    { args: ["validate", "--strict", "--json", "--no-json"], json: false },
    { args: ["--validate", "--strict", "--no-json", "--json"], json: true },
    {
      args: [
        "--config",
        JSON.stringify({ validate: true, strict: true, json: true }),
      ],
      json: true,
    },
  ];
  for (const entry of cases)
    await assert.rejects(
      execute(process.execPath, [cli, ...entry.args], { cwd }),
      (error) => {
        assert.equal(error.code, 1);
        if (entry.json) {
          const result = JSON.parse(error.stdout);
          assert.equal(result.command, "validate");
          assert.equal(result.ok, false);
        } else {
          assert.equal(error.stdout, "");
          assert.match(error.stderr, /unknownSetting/);
        }
        return true;
      },
    );
  await assert.rejects(
    execute(process.execPath, [cli, "--config", "{invalid", "--json"], { cwd }),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).ok, false);
      return true;
    },
  );
});

test("development events cover startup, successful saves, failures, recovery and idempotent cleanup", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "document.body.textContent='ready';",
    "index.html": "<html><script src='/dist/index.js'></script></html>",
  });
  const events = [];
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
    { cwd, watch: false, onEvent: (event) => events.push(event) },
  );
  t.after(() => app.close());
  const url = app.server.url;
  assert.equal(events.find((item) => item.type === "ready").url, url);
  await fs.writeFile(path.join(cwd, "index.js"), "this is invalid !!!");
  await assert.rejects(app.rebuild(["index.js"]), /Expected.*is/);
  await fs.writeFile(
    path.join(cwd, "index.js"),
    "document.body.textContent='fixed';",
  );
  await app.rebuild(["index.js"]);
  assert.equal(events.findLast((item) => item.type === "built").url, url);
  await app.close();
  await app.close();
  assert.deepEqual(
    events.map((item) => item.type),
    [
      "building",
      "built",
      "ready",
      "building",
      "build-error",
      "building",
      "built",
      "closed",
    ],
  );
  assert.deepEqual(
    events.map((item) => item.sequence),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  for (const event of events) {
    assert.equal(event.schemaVersion, 1);
    assert.ok(Number.isFinite(Date.parse(event.time)));
  }
  await assert.rejects(fetch(url));
});

test("CLI build JSON is newline-delimited events even with stats enabled", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "export const result=42;",
    "tinybuild.config.mjs":
      "export default {stats:true,server:false,bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false}};",
  });
  const { stdout, stderr } = await execute(
    process.execPath,
    [cli, "build", "--json"],
    { cwd },
  );
  const records = stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map((item) => item.type),
    ["building", "built", "ready", "closed"],
  );
  assert.match(stderr, /Built/);
});

test("project checks build, test files and URLs, preserve running servers, and skip process launch", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "export const x=42;",
    "index.html": "<html>hello</html>",
  });
  const config = {
    bundler: { entryPoints: ["index.js"], outfile: "dist/index" },
    server: { port: 0, host: "127.0.0.1" },
    tasks: { bad: { command: "nonexistent-should-never-launch" } },
    electron: { action: "open" },
    checks: {
      files: ["dist/index.js"],
      urls: [
        { path: "/", includes: "hello" },
        { path: "/missing", status: 404 },
      ],
    },
  };
  const app = await packager(
    {
      ...config,
      bundler: false,
      electron: false,
      tasks: undefined,
      checks: undefined,
    },
    { cwd, watch: false },
  );
  t.after(() => app.close());
  const result = await checkProject(config, { cwd });
  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 4);
  assert.equal(result.native.sdk, "not-run");
  assert.equal((await fetch(app.server.url)).status, 200);
  assert.equal((await fs.readdir(cwd)).includes("electron"), false);
  await assert.rejects(
    checkProject(
      { ...config, checks: { urls: [{ path: "/", includes: "not here" }] } },
      { cwd },
    ),
    /missing expected text/,
  );
  await assert.rejects(
    checkProject({ ...config, checks: { files: ["missing.js"] } }, { cwd }),
    /ENOENT/,
  );
});

test("native project checking stages configured targets without SDK launch or signing", async (t) => {
  const cwd = await fixture(t, {
    "index.js": "document.body.textContent='app';",
    "index.html": "<html>app</html>",
  });
  const result = await checkProject(
    {
      bundler: { entryPoints: ["index.js"], outfile: "dist/index" },
      server: false,
      native: {
        id: "com.example.check",
        signing: { requiredEnv: ["NEVER_SET_FOR_TEST"], command: ["bad"] },
        targets: { electron: { action: "open", watch: true } },
      },
    },
    { cwd, stage: true },
  );
  assert.equal(result.ok, true);
  assert.ok(result.steps.find((item) => item.name === "native-stage"));
  await fs.access(path.join(cwd, "electron/package.json"));
  await checkProject(
    {
      bundler: { entryPoints: ["index.js"], outfile: "dist/index" },
      server: false,
      electron: "custom-shell",
    },
    { cwd, stage: true },
  );
  await fs.access(path.join(cwd, "custom-shell/package.json"));
});

test("project check rejects malformed paths/status/timeouts and cancels slow HTTP responses", async (t) => {
  for (const checks of [
    { files: ["../secret"] },
    { files: ["C:\\secret"] },
    { urls: [{ path: "//other" }] },
    { urls: [{ path: "/", status: 999 }] },
    { timeout: 0 },
    { typo: true },
  ])
    assert.throws(() => validateChecks(checks));
  const cwd = await fixture(t);
  await assert.rejects(
    checkProject(
      {
        bundler: false,
        server: { routes: { "/slow": () => true } },
        checks: { urls: [{ path: "/slow" }], timeout: 30 },
      },
      { cwd },
    ),
    /timeout|abort/i,
  );
});

test("target-aware doctor checks tools and authorized devices with actionable remedies", () => {
  assert.equal(
    doctor().some((item) => /rust|cargo|Android/.test(item.name)),
    false,
  );
  const calls = [];
  const checks = doctor(process.cwd(), {
    target: "android",
    env: {},
    run: (name, args) => {
      calls.push([name, args]);
      return {
        status: 0,
        stdout: "List of devices attached\nABC unauthorized\n",
      };
    },
  });
  assert.ok(
    checks
      .find((item) => item.name === "Android device")
      .remedy.includes("Accept"),
  );
  assert.equal(checks.find((item) => item.name === "Android device").ok, false);
  assert.equal(calls.length, 2);
  assert.throws(
    () => doctor(process.cwd(), { target: "unknown" }),
    /Unknown doctor target/,
  );
});

test("doctor distinguishes missing SDK commands, unavailable simulators and ready simulators", () => {
  const noTools = doctor(process.cwd(), {
    target: "tauri",
    run: () => ({ status: 1 }),
  });
  assert.equal(noTools.find((item) => item.name === "cargo").ok, false);
  const noSimulator = doctor(process.cwd(), {
    target: "ios",
    platform: "darwin",
    run: () => ({ status: 0, stdout: '{"devices":{}}' }),
  });
  assert.equal(
    noSimulator.find((item) => item.name === "iOS simulator").ok,
    false,
  );
  const simulator = doctor(process.cwd(), {
    target: "ios",
    platform: "darwin",
    run: () => ({
      status: 0,
      stdout: '{"devices":{"runtime":[{"isAvailable":true}]}}',
    }),
  });
  assert.equal(
    simulator.find((item) => item.name === "iOS simulator").ok,
    true,
  );
  assert.equal(
    doctor(process.cwd(), { target: "ios", platform: "win32" }).find(
      (item) => item.name === "macOS",
    ).ok,
    false,
  );
});

test("shipped starter recipes stay synchronized, build and keep complete config references", async (t) => {
  assert.deepEqual(await syncStarters({ check: true }), []);
  assert.equal(listStarters("worker")[0].name, "webworkers");
  for (const recipe of listStarters()) {
    const cwd = await fixture(t);
    await initStarter(recipe.name, { cwd, agentGuide: true });
    const scripts = JSON.parse(
      await fs.readFile(path.join(cwd, "package.json"), "utf8"),
    ).scripts;
    assert.ok(
      Object.values(scripts).every(
        (command) => !command.includes("../../tinybuild"),
      ),
    );
    if (recipe.name === "server_workflow") {
      assert.equal(scripts.build, "tinybuild build --production");
      assert.equal(scripts.serve, "tinybuild serve --production");
      assert.equal(scripts.env, "tinybuild dev --envFile demo.env");
    }
    if (["default_ts", "worker_types"].includes(recipe.name)) {
      const pkg = JSON.parse(
        await fs.readFile(path.join(cwd, "package.json"), "utf8"),
      );
      assert.equal(pkg.scripts.typecheck, "tsc -p tsconfig.json");
      assert.ok(pkg.devDependencies.typescript);
    }
    const source = await fs.readFile(
      path.join(cwd, "tinybuild.config.js"),
      "utf8",
    );
    assert.match(source, /tinybuild:reference:options/);
    const readme = await fs.readFile(path.join(cwd, "README.md"), "utf8");
    assert.match(readme, /## Run/);
    assert.ok(!readme.includes("../../tinybuild"));
    assert.ok(!readme.includes("Install repository dependencies"));
    assert.ok(!readme.includes("`tinybuild "));
    assert.doesNotMatch(
      readme,
      /\]\(\.\.\//,
      "Starter links must stay inside the created app",
    );
    const config = await loadConfig("tinybuild.config.js", cwd, true);
    // This test uses the repository's installed TypeScript, while a starter
    // declares it explicitly when declarations are requested.
    const result = await checkProject(config, {
      cwd,
      stage: recipe.name === "native_shells",
    });
    assert.equal(result.ok, true, recipe.name);
    assert.match(
      await fs.readFile(path.join(cwd, "TINYBUILD_AGENT.md"), "utf8"),
      /schemaVersion/,
    );
  }
});

test("starter initialization preserves existing instructions and refuses occupied app folders", async (t) => {
  const cwd = await fixture(t, {
    "AGENTS.md": "existing instructions",
    "TINYBUILD_AGENT.md": "custom guide",
  });
  await initStarter("webworkers", { cwd, agentGuide: true });
  assert.equal(
    await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8"),
    "existing instructions",
  );
  assert.equal(await addAgentGuide(cwd), false);
  assert.equal(
    await fs.readFile(path.join(cwd, "TINYBUILD_AGENT.md"), "utf8"),
    "custom guide",
  );
  await assert.rejects(initStarter("default", { cwd }), /must be empty/);
  await assert.rejects(initStarter("../../other", { cwd }), /Unknown starter/);
});

test("declarations resolve named type packages in another project and recognize CSS side effects", async (t) => {
  const cwd = await fixture(t, {
    "index.ts":
      "import './style.css';export const value: LocalPackage.Value = {answer:42};",
    "style.css": "body{color:red}",
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        types: ["local-types"],
        noUncheckedSideEffectImports: true,
      },
    }),
    "node_modules/local-types/package.json":
      '{"name":"local-types","types":"index.d.ts"}',
    "node_modules/local-types/index.d.ts":
      "declare namespace LocalPackage {interface Value {answer:number}}",
  });
  const result = await bundleTypes({
    absWorkingDir: cwd,
    entryPoints: ["index.ts"],
    outdir: "dist",
  });
  assert.ok(
    result.outputs.some((item) => item.text.includes("LocalPackage.Value")),
  );
  assert.equal(
    (await fs.readdir(cwd)).includes(".tinybuild-css-imports.d.ts"),
    false,
  );
  await fs.writeFile(
    path.join(cwd, "index.ts"),
    "export const broken:number='still catches actual errors';",
  );
  await assert.rejects(
    bundleTypes({
      absWorkingDir: cwd,
      entryPoints: ["index.ts"],
      outdir: "dist",
    }),
    /not assignable/,
  );
});

test("machine output keeps owned task logs on stderr and reports HTTP debug logs separately", async (t) => {
  const module = pathToFileURL(
    fileURLToPath(new URL("../tinybuild/cli.js", import.meta.url)),
  ).href;
  const cwd = await fixture(t, {
    "tinybuild.config.mjs": `export default {bundler:false,server:{port:0,host:'127.0.0.1',debug:true},tasks:{setup:{command:${JSON.stringify(process.execPath)},args:['-e',"console.log('TASK LOG')"],mode:'once'}}};`,
    "index.html": "<html>ready</html>",
    "probe.mjs": `import {runTinybuild} from ${JSON.stringify(module)};const app=await runTinybuild(['serve','--json']);await fetch(app.server.url);await app.close();`,
  });
  const { stdout, stderr } = await execute(process.execPath, ["probe.mjs"], {
    cwd,
  });
  const records = stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map((item) => item.type),
    ["ready", "closed"],
  );
  assert.match(stderr, /TASK LOG/);
  assert.match(stderr, /"status":200/);
});

test("static edits and invalid config saves send useful development events", async (t) => {
  const source =
    "export default {bundler:false,server:{port:0,host:'127.0.0.1',delay:20}};";
  const cwd = await fixture(t, {
    "index.html": "<html>first</html>",
    "tinybuild.config.mjs": source,
  });
  const events = [];
  const app = await packager(
    await loadConfig("tinybuild.config.mjs", cwd, true),
    {
      cwd,
      configPath: "tinybuild.config.mjs",
      onEvent: (event) => events.push(event),
      onError: () => {},
    },
  );
  t.after(() => app.close());
  await fs.writeFile(path.join(cwd, "index.html"), "<html>second</html>");
  await until(() =>
    events.some(
      (event) => event.type === "built" && event.files?.includes("/index.html"),
    ),
  );
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default {server:{port:'bad'}};",
  );
  await until(() => events.some((event) => event.type === "build-error"));
  assert.equal(
    events.filter((event) => event.type === "build-error").length,
    1,
  );
  assert.equal((await fetch(app.server.url)).status, 200);
});

test("plain init ships the full annotated config and JSON check failures exit nonzero", async (t) => {
  const cwd = await fixture(t);
  await execute(process.execPath, [cli, "init", "--agentGuide", "--json"], {
    cwd,
  });
  assert.match(
    await fs.readFile(path.join(cwd, "tinybuild.config.js"), "utf8"),
    /PROJECT CHECKS/,
  );
  await execute(process.execPath, [cli, "check", "--json"], { cwd });
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.js"),
    "export default {bundler:false,checks:{files:['missing.js']}};",
  );
  await assert.rejects(
    execute(process.execPath, [cli, "check", "--json"], { cwd }),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).ok, false);
      return true;
    },
  );
});
