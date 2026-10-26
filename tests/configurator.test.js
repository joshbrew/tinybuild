import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture } from "./helpers.js";
import { configure, writeConfigEdits } from "../tinybuild/configure.js";
import { loadConfig } from "../tinybuild/config.js";
import { parseArgs } from "../tinybuild/commands/command.js";

test("guided production and static-server recipes produce complete independent workflows", async (t) => {
  for (const recipe of ["production", "server"]) {
    const cwd = await fixture(t, {
      "tinybuild.config.mjs":
        "// keep the complete source\nexport default {bundler:{entryPoints:['index.js'],outfile:'dist/index'},server:{port:8080}};",
    });
    const answers =
      recipe === "production"
        ? [recipe, "", "public", "0", "", "y"]
        : [recipe, "static", "0", "", "y"];
    await configure({
      cwd,
      question: async () => answers.shift(),
      log: () => {},
    });
    const config = await loadConfig("tinybuild.config.mjs", cwd, true);
    assert.equal(config.server.port, 0);
    assert.equal(config.server.hotreload, false);
    assert.equal(config.electron, false);
    if (recipe === "production") {
      assert.equal(config.production, true);
      assert.equal(config.bundler.bundleHTML, true);
      assert.equal(config.bundler.bundleGzip, true);
      assert.equal(config.server.root, "public");
    } else {
      assert.equal(config.bundler, false);
      assert.equal(config.server.root, "static");
    }
  }
});

test("config command preserves JSON override syntax and supports guided/scripted editing", () => {
  assert.deepEqual(
    parseArgs(["config", "--set", '{"server":{"port":9000}}', "--yes"]),
    { configure: true, set: { server: { port: 9000 } }, yes: true },
  );
  assert.deepEqual(parseArgs(["--config", '{"server":{"port":9000}}']), {
    server: { port: 9000 },
  });
});
test("guided ESM edits preserve code/comments, back up originals, and update a single managed section", async (t) => {
  const source =
    '// Keep this comment\nconst plugin={name:"custom",setup(){}};\nexport default {bundler:{entryPoints:["index.js"],outfile:"dist/index",plugins:[plugin]},server:{port:8080,routes:{"/hello":(req,res)=>res.end("hello")}}};\n';
  const cwd = await fixture(t, { "tinybuild.config.mjs": source });
  const answers = ["portable", "", "public", "9000", "y", "y"];
  const result = await configure({
    cwd,
    question: async () => answers.shift(),
    log: () => {},
  });
  assert.equal(await fs.readFile(result.backup, "utf8"), source);
  let config = await loadConfig("tinybuild.config.mjs", cwd, true);
  assert.equal(config.server.port, 9000);
  assert.equal(typeof config.server.routes["/hello"], "function");
  assert.equal(config.bundler.plugins[0].name, "custom");
  assert.equal(config.bundler.outfile, undefined);
  assert.equal(config.bundler.outdir, "public");
  await configure({
    cwd,
    edits: { server: { port: 9001 } },
    yes: true,
    log: () => {},
  });
  config = await loadConfig("tinybuild.config.mjs", cwd, true);
  assert.equal(config.server.port, 9001);
  assert.equal(config.bundler.bundleHTML, true);
  const next = await fs.readFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "utf8",
  );
  assert.ok(next.includes("// Keep this comment"));
  assert.equal(next.match(/tinybuild:config:start/g).length, 1);
});
test("config editor supports CommonJS, preview, cancellation and refuses malformed or concurrently changed source", async (t) => {
  const cwd = await fixture(t, {
    "tinybuild.config.cjs": "// custom\nmodule.exports={server:{port:8080}};\n",
  });
  const before = await fs.readFile(
    path.join(cwd, "tinybuild.config.cjs"),
    "utf8",
  );
  await configure({
    cwd,
    edits: { server: { port: 8081 } },
    dryRun: true,
    log: () => {},
  });
  assert.equal(
    await fs.readFile(path.join(cwd, "tinybuild.config.cjs"), "utf8"),
    before,
  );
  const cancel = await configure({
    cwd,
    edits: { server: { port: 8081 } },
    question: async () => "n",
    log: () => {},
  });
  assert.equal(cancel.cancelled, true);
  await configure({
    cwd,
    edits: { server: { port: 8081 } },
    yes: true,
    log: () => {},
  });
  assert.equal(
    (await loadConfig("tinybuild.config.cjs", cwd, true)).server.port,
    8081,
  );
  await assert.rejects(
    writeConfigEdits(
      "tinybuild.config.cjs",
      {},
      { cwd, expectedSource: "old" },
    ),
    /changed while editing/,
  );
  await fs.writeFile(path.join(cwd, "bad.mjs"), "// no config export\n");
  await assert.rejects(
    writeConfigEdits("bad.mjs", {}, { cwd }),
    /one top-level/,
  );
  await assert.rejects(
    configure({
      cwd,
      edits: { server: { port: "bad" } },
      yes: true,
      log: () => {},
    }),
    /integer/,
  );
});
test("new config preview is side-effect free and creation uses the complete annotated reference", async (t) => {
  const cwd = await fixture(t);
  await configure({
    cwd,
    edits: { server: { port: 8081 } },
    dryRun: true,
    log: () => {},
  });
  assert.deepEqual(await fs.readdir(cwd), []);
  await configure({
    cwd,
    edits: { server: { port: 8081 } },
    yes: true,
    log: () => {},
  });
  const source = await fs.readFile(
    path.join(cwd, "tinybuild.config.js"),
    "utf8",
  );
  assert.ok(source.includes("mobile=android"));
  assert.ok(source.includes("hotreloadTransport"));
  const config = await loadConfig("tinybuild.config.js", cwd, true);
  assert.equal(config.server.port, 8081);
});

test("the annotated default covers every public option group and validates strictly", async () => {
  const { configOptions, validateConfig } =
    await import("../tinybuild/config-options.js");
  const source = await fs.readFile(
    new URL("../tinybuild/templates/tinybuild.config.js", import.meta.url),
    "utf8",
  );
  for (const group of ["root", "native", "tasks", "budgets", "diagnostics"])
    for (const name of configOptions[group])
      assert.ok(
        source.includes(name),
        "Missing documented " + group + "." + name,
      );
  const reference = (await import("../tinybuild/templates/tinybuild.config.js"))
    .default;
  assert.deepEqual(validateConfig(reference, { strict: true }), {
    errors: [],
    warnings: [],
  });
});
test("config editing handles inline exports and ignores export-like comments and strings", async (t) => {
  const cwd = await fixture(t, {
    "tinybuild.config.mjs":
      '// export default fake;\nconst text="export default text";export default {metadata:{text},server:{port:8080}};\n',
  });
  await configure({
    cwd,
    edits: { server: { port: 8081 } },
    yes: true,
    log: () => {},
  });
  const config = await loadConfig("tinybuild.config.mjs", cwd, true);
  assert.equal(config.metadata.text, "export default text");
  assert.equal(config.server.port, 8081);
});

test("managed config edits survive formatting and Windows line endings", async (t) => {
  const { format } = await import("prettier");
  const cwd = await fixture(t, {
    "tinybuild.config.mjs":
      'export default {server:{port:8080},metadata:{note:"keep"}};\n',
  });
  await configure({
    cwd,
    edits: {
      server: { port: 8081 },
      metadata: { nested: { value: "literal }; text" } },
    },
    yes: true,
    log: () => {},
  });
  const filename = path.join(cwd, "tinybuild.config.mjs");
  const text = await fs.readFile(filename, "utf8");
  await fs.writeFile(
    filename,
    await format(text, {
      parser: "babel",
      endOfLine: "crlf",
      singleQuote: true,
    }),
  );
  await configure({
    cwd,
    edits: { server: { port: 8082 } },
    yes: true,
    log: () => {},
  });
  const config = await loadConfig("tinybuild.config.mjs", cwd, true);
  assert.equal(config.server.port, 8082);
  assert.equal(config.metadata.nested.value, "literal }; text");
});

test("scripted JSON edits reject new callbacks instead of silently dropping them", async (t) => {
  const cwd = await fixture(t, {
    "tinybuild.config.mjs": "export default {server:{port:8080}};\n",
  });
  const before = await fs.readFile(
    path.join(cwd, "tinybuild.config.mjs"),
    "utf8",
  );
  await assert.rejects(
    configure({
      cwd,
      edits: { server: { routes: { "/hello": () => true } } },
      yes: true,
      log: () => {},
    }),
    /must be JSON data/,
  );
  assert.equal(
    await fs.readFile(path.join(cwd, "tinybuild.config.mjs"), "utf8"),
    before,
  );
});
