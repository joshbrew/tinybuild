import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { help, runTinybuild } from "../tinybuild/cli.js";
import * as commands from "../tinybuild/commands/index.js";
import { configure } from "../tinybuild/configure.js";
import { loadConfig } from "../tinybuild/config.js";
import { initRepo } from "../tinybuild/repo.js";
import { checkProject } from "../tinybuild/project-check.js";
import { fixture } from "./helpers.js";
const execute = promisify(execFile);

test("help groups runnable examples, wraps long lists and retains every accepted option", () => {
  const text = help();
  for (const title of [
    "Start here",
    "Build and check",
    "Workers and native apps",
    "Troubleshoot",
  ])
    assert.ok(text.includes(title));
  assert.ok(text.split("\n").every((line) => line.length <= 100));
  for (const group of ["basic", "bundler", "server"])
    for (const name of Object.keys(commands[group]))
      assert.ok(text.includes(name), name);
});

test("starter discovery is readable in terminals and preserves the JSON result contract", async (t) => {
  const cwd = await fixture(t),
    lines = [];
  await runTinybuild(["init", "--list", "--search", "worker"], {
    cwd,
    log: (line) => lines.push(line),
  });
  assert.match(lines.join("\n"), /webworkers\s+Browser/);
  assert.match(lines.at(-1), /init --example <name>/);
  assert.ok(!lines.join("").includes('"description"'));
  lines.length = 0;
  await runTinybuild(["init", "--list", "--search", "no-such-example"], {
    cwd,
    log: (line) => lines.push(line),
  });
  assert.match(lines[0], /No starters match/);
  const records = [];
  await runTinybuild(["init", "--list", "--search", "worker", "--json"], {
    cwd,
    write: (line) => records.push(JSON.parse(line)),
  });
  assert.equal(records[0].schemaVersion, 1);
  assert.equal(records[0].command, "init");
  assert.ok(records[0].data.some((item) => item.name === "worker_types"));
  assert.deepEqual(await fs.readdir(cwd), []);
});

test("starter next steps match browser, library and native staging workflows", async (t) => {
  for (const [name, finalCommand] of [
    ["default", "npm start"],
    ["library", "npm run build"],
    ["native_shells", "npm run build"],
  ]) {
    const cwd = await fixture(t),
      lines = [];
    const result = await runTinybuild(
      ["init", "--example", name, "--dir", "my app"],
      { cwd, log: (line) => lines.push(line) },
    );
    assert.equal(result.next.at(-1), finalCommand);
    assert.equal(result.next.length, 2);
    assert.match(lines[0], /Created .*my app/);
    assert.ok(
      lines.some((line) => line.includes("Open a terminal in that folder")),
    );
    assert.ok(lines.includes("  " + finalCommand));
    assert.ok(!lines.join("\n").includes('"files"'));
    const readme = await fs.readFile(
      path.join(cwd, "my app/README.md"),
      "utf8",
    );
    assert.match(readme, /## Run/);
    assert.ok(readme.includes(finalCommand));
    assert.ok(
      !readme.includes("../../tinybuild") &&
        !readme.includes("Install repository dependencies"),
    );
    if (name !== "default")
      assert.ok(!readme.includes("Follow the printed URL"));
  }
});

test("library and Node config recipes skip web-server questions", async (t) => {
  for (const recipe of ["library", "node"]) {
    const cwd = await fixture(t),
      questions = [];
    const answers = [recipe, "src/main.ts", "output", "y"];
    await configure({
      cwd,
      question: async (text) => {
        questions.push(text);
        return answers.shift();
      },
      log() {},
    });
    assert.equal(answers.length, 0);
    assert.ok(!questions.some((text) => /port|Hot reload/.test(text)));
    const config = await loadConfig("tinybuild.config.js", cwd, true);
    assert.equal(config.server, false);
    assert.equal(config.bundler.outdir, "output");
    assert.equal(config.bundler.bundleBrowser, false);
    assert.equal(
      config.bundler[recipe === "node" ? "bundleNode" : "bundleESM"],
      true,
    );
  }
});

test("current config recipe keeps disabled components disabled and preserves the static root", async (t) => {
  for (const config of [
    {
      bundler: { entryPoints: ["index.js"], outfile: "dist/index" },
      server: false,
    },
    { bundler: false, server: { port: 8080 } },
    { bundler: false, server: false },
  ]) {
    const cwd = await fixture(t, {
      "tinybuild.config.mjs": "export default " + JSON.stringify(config),
    });
    const questions = [];
    await configure({
      cwd,
      question: async (text) => {
        questions.push(text);
        return text.startsWith("Save config") ? "y" : "";
      },
      log() {},
    });
    const result = await loadConfig("tinybuild.config.mjs", cwd, true);
    if (config.bundler === false) {
      assert.equal(result.bundler, false);
      assert.ok(!questions.some((text) => text.startsWith("Entry file")));
    }
    if (config.server === false) {
      assert.equal(result.server, false);
      assert.ok(!questions.some((text) => /port|Hot reload/.test(text)));
    } else assert.equal(result.server.root, undefined);
  }
});

test("config review shows selected redacted settings and output destinations before saving", async (t) => {
  const cwd = await fixture(t, {
    "tinybuild.config.mjs":
      "export default {bundler:{entryPoints:['index.js'],outfile:'dist/index'},server:{port:8080},metadata:{longNotes:'unrelated-existing-value'}};",
  });
  const lines = [];
  await configure({
    cwd,
    edits: {
      server: { port: 8081 },
      native: { env: { API_KEY: "private-value" } },
    },
    dryRun: true,
    log: (line) => lines.push(line),
  });
  const review = lines.join("\n");
  assert.match(review, /Settings to save/);
  assert.match(review, /"port": 8081/);
  assert.match(review, /Builds: browser/);
  assert.match(review, /dist[/\\]index.js/);
  assert.match(review, /Web server: http/);
  assert.match(review, /\[redacted\]/);
  assert.ok(!review.includes("private-value"));
  assert.ok(!review.includes("unrelated-existing-value"));
  assert.deepEqual(await fs.readdir(cwd), ["tinybuild.config.mjs"]);
});

test("option help starts with common settings and explains searched values without changing JSON data", async (t) => {
  const cwd = await fixture(t),
    lines = [];
  const all = await runTinybuild(["options"], {
    cwd,
    log: (line) => lines.push(line),
  });
  assert.ok(all.length > 100);
  assert.match(lines.join("\n"), /Showing common settings/);
  assert.ok(lines.includes("bundler.entryPoints"));
  assert.ok(!lines.includes("bundler.workerBundler"));
  lines.length = 0;
  const matched = await runTinybuild(["options", "--search", "server.delay"], {
    cwd,
    log: (line) => lines.push(line),
  });
  assert.match(lines.join("\n"), /Default when omitted: 150/);
  assert.match(lines.join("\n"), /Accepts: a number/);
  assert.ok(
    lines
      .join("\n")
      .split("\n")
      .every((line) => line.length <= 88),
  );
  const records = [];
  await runTinybuild(["options", "--search", "server.delay", "--json"], {
    cwd,
    write: (line) => records.push(JSON.parse(line)),
  });
  assert.deepEqual(records[0].data, matched);
  assert.equal(records[0].command, "options");
  lines.length = 0;
  await runTinybuild(["options", "--search", "not-a-setting"], {
    cwd,
    log: (line) => lines.push(line),
  });
  assert.match(lines.join("\n"), /No settings match/);
  assert.deepEqual(await fs.readdir(cwd), []);
});

test("doctor labels tool failures and deduplicates remedies while preserving structured checks", async (t) => {
  const cwd = await fixture(t),
    lines = [];
  const options = {
    cwd,
    doctor: { run: () => ({ status: 1 }) },
    log: (line) => lines.push(line),
  };
  const checks = await runTinybuild(["doctor", "--target", "tauri"], options);
  assert.match(lines.join("\n"), /OK  Node/);
  assert.match(lines.join("\n"), /MISSING  rustc/);
  assert.match(lines.join("\n"), /MISSING  cargo/);
  assert.equal(
    lines.filter((line) => line.includes("Install the Rust toolchain")).length,
    1,
  );
  const records = [];
  await runTinybuild(["doctor", "--target", "tauri", "--json"], {
    ...options,
    write: (line) => records.push(JSON.parse(line)),
  });
  assert.equal(records[0].ok, false);
  assert.deepEqual(records[0].data, checks);
  assert.deepEqual(await fs.readdir(cwd), []);
});

test("project checks explain skipped work and distinguish real staging from SDK validation", async (t) => {
  const cwd = await fixture(t, {
    "index.html": "<html>hello</html>",
    "index.js": "console.log('hello');",
    "tinybuild.config.mjs":
      "export default {bundler:false,server:{host:'127.0.0.1',port:0},checks:{files:['index.html'],urls:[{path:'/',includes:'hello'}]}};",
  });
  const lines = [];
  const result = await runTinybuild(["check", "--stage"], {
    cwd,
    log: (line) => lines.push(line),
  });
  assert.match(lines.join("\n"), /SKIP  Build \(bundling is disabled\)/);
  assert.match(lines.join("\n"), /OK  File: index.html/);
  assert.match(lines.join("\n"), /OK  URL: \//);
  assert.match(
    lines.join("\n"),
    /SKIP  Native app files \(no native targets configured\)/,
  );
  assert.ok(!lines.some((line) => line.includes("Staged app files")));
  const records = [];
  await runTinybuild(["check", "--stage", "--json"], {
    cwd,
    write: (line) => records.push(JSON.parse(line)),
  });
  assert.deepEqual(records[0].data, result);
  lines.length = 0;
  await runTinybuild(
    {
      check: true,
      stage: true,
      electron: { action: "stage" },
      bundler: {
        entryPoints: ["index.js"],
        outfile: "dist/index",
        autoInstall: false,
      },
    },
    { cwd, log: (line) => lines.push(line) },
  );
  assert.match(lines.join("\n"), /OK  Native app files/);
  assert.match(
    lines.join("\n"),
    /SDK, device and signing checks run separately/,
  );
  await fs.access(path.join(cwd, "electron/web/index.html"));
});

test("mobile launch scripts produce device-specific plans without platform tools", async () => {
  const cwd = fileURLToPath(
    new URL("../examples/mobile_debug/", import.meta.url),
  );
  const pkg = JSON.parse(
    await fs.readFile(path.join(cwd, "package.json"), "utf8"),
  );
  for (const platform of ["android", "ios"]) {
    const args = pkg.scripts[platform + ":dev"].split(" ").slice(1);
    const { stdout } = await execute(
      process.execPath,
      [...args, "--preview", "--device", "demo-device", "--json"],
      { cwd },
    );
    const plan = JSON.parse(stdout);
    const target = plan.data.native.find((item) => item.target === platform);
    assert.equal(target.action, "run");
    assert.ok(target.commands.some((args) => args.includes("demo-device")));
  }
});

test("documented mobile check flags produce an install and relaunch plan without a device", async (t) => {
  const cwd = await fixture(t);
  const script = fileURLToPath(
    new URL("../scripts/check-mobile.js", import.meta.url),
  );
  const { stdout } = await execute(
    process.execPath,
    [
      script,
      "--platform",
      "android",
      "--artifact",
      "app.apk",
      "--device",
      "demo-device",
      "--id",
      "com.example.app",
      "--dryRun",
    ],
    { cwd },
  );
  const plan = JSON.parse(stdout);
  assert.equal(plan.platform, "android");
  assert.equal(plan.checked, false);
  assert.ok(
    plan.commands.some(
      ([command, args]) => command.includes("adb") && args.includes("install"),
    ),
  );
  assert.ok(
    plan.checkpoints.some((checkpoint) => checkpoint.phase === "relaunched"),
  );
  assert.deepEqual(await fs.readdir(cwd), []);
});

test("named scaffold entries import the matching stylesheet and serve readable nested HTML", async (t) => {
  for (const entry of ["src/main.js", "src/card.ts", "src/price$&.js"]) {
    const cwd = await fixture(t);
    await initRepo(cwd, [entry], undefined, {
      bundler: {
        entryPoints: [entry],
        outfile: "output/app&more",
        bundleBrowser: true,
        autoInstall: false,
      },
      server: { startpage: "pages/home.html" },
    });
    const css = entry.replace(/\.[^.]+$/, ".css");
    const source = await fs.readFile(path.join(cwd, entry), "utf8");
    assert.ok(source.includes(JSON.stringify("./" + path.basename(css))));
    const html = await fs.readFile(path.join(cwd, "pages/home.html"), "utf8");
    assert.match(html, /\n    <meta name="viewport"/);
    assert.match(html, /\.\.\/output\/app%26more\.js/);
    const readme = await fs.readFile(path.join(cwd, "README.md"), "utf8");
    assert.ok(readme.includes("`" + entry + "`"));
    assert.ok(readme.includes("`" + css + "`"));
    assert.ok(readme.includes("`pages/home.html`"));
    assert.ok(!readme.includes("`index.js`"));
    const config = await loadConfig("tinybuild.config.js", cwd, true);
    config.checks = {
      files: ["output/app&more.js", "output/app&more.css"],
      urls: [
        { path: "/", includes: "app%26more.js" },
        { path: "/output/app%26more.js", includes: "Hello World" },
      ],
    };
    assert.equal((await checkProject(config, { cwd })).ok, true);
  }
});

test("serverless scaffold instructions describe its real files and preserve existing readmes", async (t) => {
  const cwd = await fixture(t);
  const config = {
    bundler: { entryPoints: ["src/main.js"], outfile: "dist/main" },
    server: false,
  };
  await initRepo(cwd, ["src/main.js"], "console.log('custom entry');", config);
  const readme = await fs.readFile(path.join(cwd, "README.md"), "utf8");
  assert.ok(readme.includes("does not start a web server"));
  assert.ok(readme.includes("npm install\nnpm run build"));
  assert.ok(!readme.includes("Follow the printed URL"));
  assert.ok(
    !readme.includes("`index.html`") && !readme.includes("`src/main.css`"),
  );
  assert.ok(!readme.includes("Serve files I already built"));
  await fs.writeFile(path.join(cwd, "README.md"), "My project notes");
  await initRepo(cwd, ["src/main.js"], undefined, config);
  assert.equal(
    await fs.readFile(path.join(cwd, "README.md"), "utf8"),
    "My project notes",
  );
});

test("web startup announces its URL once and keeps reporting it after each successful rebuild", async (t) => {
  let app;
  t.after(() => app?.close());
  const cwd = await fixture(t, {
    "index.js": "console.log(1);",
    "index.html": "hello",
    "tinybuild.config.mjs":
      "export default {bundler:{entryPoints:['index.js'],outfile:'dist/index',autoInstall:false},server:{host:'127.0.0.1',port:0}};",
  });
  const lines = [];
  app = await runTinybuild(["dev"], {
    cwd,
    watch: false,
    log: (line) => lines.push(line),
    onReady: () => lines.push("Package startup finished"),
  });
  const listening = "Tinybuild listening at " + app.server.url;
  assert.equal(lines.filter((line) => line === listening).length, 1);
  assert.equal(lines.at(-2), "Package startup finished");
  assert.equal(lines.at(-1), listening);
  await fs.writeFile(path.join(cwd, "index.js"), "console.log(2);");
  await app.rebuild(["index.js"]);
  assert.equal(lines.at(-1), listening);
  assert.equal(lines.filter((line) => line === listening).length, 2);
});

test("one-shot builds list output paths concisely and keep JSON events free of display text", async (t) => {
  const cwd = await fixture(t);
  const entries = Array.from(
    { length: 9 },
    (_, index) => "entry" + index + ".js",
  );
  for (const entry of entries)
    await fs.writeFile(path.join(cwd, entry), "console.log(42);");
  await fs.writeFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "export default " +
      JSON.stringify({
        bundler: { entryPoints: entries, outdir: "dist", autoInstall: false },
        server: false,
      }),
  );
  const lines = [];
  await (
    await runTinybuild(["build"], { cwd, log: (line) => lines.push(line) })
  ).close();
  assert.ok(lines.includes("Built 9 files:"));
  assert.equal(
    lines.filter((line) => /^  dist\/entry\d.js \(\d+ bytes\)$/.test(line))
      .length,
    8,
  );
  assert.match(lines.at(-1), /1 more/);
  const records = [];
  await (
    await runTinybuild(["build", "--json"], {
      cwd,
      write: (line) => records.push(JSON.parse(line)),
    })
  ).close();
  assert.deepEqual(
    records.map((record) => record.type),
    ["building", "built", "ready", "closed"],
  );
});

test("plain initialization explains the destination and leaves JSON initialization unchanged", async (t) => {
  const cwd = await fixture(t),
    lines = [];
  const destination = await runTinybuild(["init", "--dir", "my app"], {
    cwd,
    log: (line) => lines.push(line),
  });
  assert.ok(lines[0].includes(destination));
  assert.match(lines.join("\n"), /npm install and npm start/);
  const records = [];
  await runTinybuild(["init", "--dir", "my app", "--json"], {
    cwd,
    write: (line) => records.push(JSON.parse(line)),
  });
  assert.equal(records[0].command, "init");
  assert.deepEqual(records[0].data, { cwd: destination });
});
