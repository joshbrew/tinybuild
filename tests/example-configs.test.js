import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { transform } from "esbuild";
import ts from "typescript";
import vm from "node:vm";
import { validateConfig } from "../tinybuild/config-options.js";
import { desktopDevelopment } from "../tinybuild/desktop.js";
import {
  annotateExampleConfig,
  annotateReadmeConfig,
  exampleConfigs,
  syncExampleConfigs,
} from "../scripts/sync-example-configs.js";

const template = await fs.readFile(
  new URL("../tinybuild/templates/tinybuild.config.js", import.meta.url),
  "utf8",
);
const executable = async (source) =>
  (await transform(source, { minifyWhitespace: true, legalComments: "none" }))
    .code;

test("README includes the entire runnable config and preserves the guide around it", async () => {
  const readme = await fs.readFile(
    new URL("../README.md", import.meta.url),
    "utf8",
  );
  assert.equal(
    annotateReadmeConfig(readme, template),
    readme.replace(/\r\n/g, "\n"),
  );
  const embedded = readme
    .split("<!-- tinybuild:config:start -->")[1]
    .split("<!-- tinybuild:config:end -->")[0]
    .match(/```js\n([\s\S]*?)\n```/)[1];
  assert.equal(embedded, template.trim());
  assert.equal(await executable(embedded), await executable(template));
  const source =
    "intro\r\n<!-- tinybuild:config:start -->\r\nstale\r\n<!-- tinybuild:config:end -->\r\nusage\r\n";
  const updated = annotateReadmeConfig(source, "export default {};\r\n");
  assert.ok(updated.startsWith("intro\n"));
  assert.ok(updated.endsWith("\nusage\n"));
  assert.equal(annotateReadmeConfig(updated, "export default {};\n"), updated);
  for (const broken of [
    "guide without markers",
    "<!-- tinybuild:config:end --><!-- tinybuild:config:start -->",
    source + "<!-- tinybuild:config:start -->",
    source + "<!-- tinybuild:config:end -->",
  ])
    assert.throws(
      () => annotateReadmeConfig(broken, template),
      /reference block/,
    );
});

test("the template separates explanations and settings, with readable nested options", () => {
  let settingCount = 0;
  for (const line of template.split(/\r?\n/)) {
    const setting = line.replace(/^\s*\/\/ ?/, "");
    if (!/^\s*(?:[a-z_$][\w$]*|"[^"]+")\s*:/.test(setting)) continue;
    settingCount++;
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      false,
      ts.LanguageVariant.Standard,
      setting,
    );
    for (
      let kind = scanner.scan();
      kind !== ts.SyntaxKind.EndOfFileToken;
      kind = scanner.scan()
    )
      assert.notEqual(
        kind,
        ts.SyntaxKind.SingleLineCommentTrivia,
        "Move the explanation above its setting: " + line,
      );
    assert.doesNotMatch(
      setting,
      /,\s*(?:[a-z_$][\w$]*|"[^"]+")\s*:/,
      "Put each setting on its own line: " + line,
    );
  }
  assert.ok(settingCount > 100, "Check the optional nested settings too");
  assert.doesNotMatch(template, /legacy|older custom stacks/i);
  assert.match(template, /BUDGETS: optional size limits/);
  assert.match(template, /DIAGNOSTICS: optional measurements/);
  assert.match(template, /150 = 0\.15 seconds/);
  assert.match(template, /1000 bytes is about 1 KB/);
  assert.match(template, /sourcemap: false,/);
  assert.match(template, /minify: true,/);
  assert.match(template, /minifyWhitespace: true,/);
  assert.doesNotMatch(template, /Also (?:build|save)/);
});

test("the template puts familiar build, server and reload settings before advanced options", () => {
  const position = (key) => {
    const match = new RegExp(
      "^\\s*(?:// )?" + key + ":.*(?:,|\\{|\\[)\\s*$",
      "m",
    ).exec(template);
    assert.ok(match, key);
    return match.index;
  };
  assert.ok(position("build") < position("bundler"));
  assert.ok(position("serve") < position("bundler"));
  for (const [early, late] of [
    ["entryPoints", "bundleBrowser"],
    ["bundleBrowser", "bundleESM"],
    ["bundleESM", "bundleTypes"],
    ["bundleTypes", "bundleNode"],
    ["bundleHTML", "minify"],
    ["minify", "minifyWhitespace"],
    ["minifyWhitespace", "sourcemap"],
    ["plugins", "remoteImports"],
    ["workerBundler", "outputs"],
    ["debug", "protocol"],
    ["protocol", "host"],
    ["port", "startpage"],
    ["startpage", "hotreload"],
    ["delay", "readinessPath"],
  ])
    assert.ok(position(early) < position(late), early + " before " + late);
});

test("the full commented Electron and Tauri objects can be enabled without contradictory settings", async () => {
  for (const group of ["electron", "tauri"]) {
    const section = new RegExp(
      "^  // " + group + ": \\{[\\s\\S]*?^  // \\},",
      "m",
    ).exec(template)?.[0];
    assert.ok(section, group);
    const source =
      "({" +
      section
        .split("\n")
        .map((line) => line.replace(/^  \/\/ ?/, ""))
        .join("\n") +
      "})";
    await transform(source, { loader: "js" });
    const config = JSON.parse(JSON.stringify(vm.runInNewContext(source)));
    assert.deepEqual(validateConfig(config).errors, [], group);
    assert.doesNotThrow(() => desktopDevelopment(config));
  }
});

test("the template retains the original config's complete option and route feature set", () => {
  const original = {
    bundler: [
      "entryPoints",
      "outfile",
      "outdir",
      "bundleBrowser",
      "bundleESM",
      "bundleTypes",
      "bundleNode",
      "bundleHTML",
      "bundleIIFE",
      "bundleCommonJS",
      "minify",
      "sourcemap",
      "plugins",
      "includeDefaultPlugins",
      "blobWorkers",
      "workerBundler",
      "globalThis",
      "globals",
      "init",
      "outputs",
      "platform",
      "loader",
    ],
    server: [
      "debug",
      "protocol",
      "host",
      "port",
      "redirect",
      "headers",
      "startpage",
      "hotreload",
      "socket_protocol",
      "routes",
      "reloadscripts",
      "delay",
      "pwa",
      "watch",
      "ignore",
      "extensions",
      "errpage",
      "certpath",
      "keypath",
      "python",
      "python_node",
    ],
    root: [
      "build",
      "serve",
      "mobile",
      "android",
      "ios",
      "electron",
      "tauri",
      "assets",
    ],
  };
  for (const [group, names] of Object.entries(original))
    for (const name of names)
      assert.match(
        template,
        new RegExp("\\b" + name + "\\s*:"),
        "Missing original " + group + " option " + name,
      );
  for (const form of [
    "/page2",
    "/custom",
    "/redirect",
    "/other",
    "/404",
    "/user/:userId/:action",
    "/product/:productId",
    "/posts/:year/:month/:slug",
  ])
    assert.ok(
      template.includes(form),
      "Missing original route example " + form,
    );
});

test("every example includes the current full commented config reference", async () => {
  const { files, stale } = await syncExampleConfigs({ check: true });
  assert.ok(files.length >= 35, "Include the nested backend config as well");
  assert.deepEqual(
    stale,
    [],
    "Run npm run sync:example-configs after editing the template",
  );
  assert.deepEqual(await exampleConfigs(), files);
  const comments = template
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("//") || line.startsWith("/**"));
  for (const filename of files) {
    const source = await fs.readFile(filename, "utf8");
    for (const comment of comments)
      assert.ok(source.includes(comment), `${filename} is missing ${comment}`);
    for (const section of ["guide", "bundler", "server", "options"])
      assert.ok(
        source.includes(`tinybuild:reference:${section}:start`),
        filename,
      );
  }
});

test("reference generation preserves executable settings, imports, plugins and macros", async () => {
  const sources = [
    "export default {bundler:false,server:false};",
    'const config={bundler:{entryPoints:["server.ts"],bundleNode:true},server:false}; export default config;',
    `import { nativeApp } from "tinybuild/native-config.js";
const plugin={name:"custom",setup(build){build.onResolve({filter:/^virtual:/},()=>({path:"demo"}));}};
const text=\`// tinybuild:reference:guide:start
// Keep these literal lines
// tinybuild:reference:guide:end\`;
export default {
  ...nativeApp({id:"com.example.test",profiles:{release:{name:"Release"}}}),
  bundler:[{entryPoints:["web.js"],plugins:[plugin]},{entryPoints:["server.js"],bundleNode:true}],
  server:{routes:{"/time":{onrequest(req,res){res.end(text);return true;}}}},
  tasks:{api:{command:"node",args:["api.js"]}}, electron:{action:"stage"}
};`,
  ];
  for (const source of sources) {
    const annotated = await annotateExampleConfig(source, template);
    assert.equal(await executable(annotated), await executable(source));
    assert.equal(await annotateExampleConfig(annotated, template), annotated);
    assert.equal(
      await annotateExampleConfig(annotated.replace(/\n/g, "\r\n"), template),
      annotated,
    );
    const file = ts.createSourceFile(
      "config.js",
      annotated,
      ts.ScriptTarget.Latest,
      true,
    );
    const exported = file.statements.find(ts.isExportAssignment).expression;
    if (ts.isObjectLiteralExpression(exported)) {
      function checkObject(node) {
        if (ts.isObjectLiteralExpression(node)) {
          const lines = node.properties.map(
            (value) =>
              file.getLineAndCharacterOfPosition(value.getStart()).line,
          );
          assert.equal(
            new Set(lines).size,
            lines.length,
            "Each active setting belongs on its own line",
          );
        }
        ts.forEachChild(node, checkObject);
      }
      checkObject(exported);
    }
  }
});

test("refreshing documentation retains options uncommented inside reference blocks", async () => {
  const source = await annotateExampleConfig(
    'export default {bundler:{entryPoints:["index.js"]},server:false};',
    template,
  );
  const edited = source.replace("// minify: true,", "minify: false,");
  const nextTemplate = template.replace(
    "// BUILD SIZE: print how many bytes were built and how long each build took.",
    "// BUILD SIZE: Updated documentation.",
  );
  const refreshed = await annotateExampleConfig(edited, nextTemplate);
  assert.equal(await executable(refreshed), await executable(edited));
  assert.match(refreshed, /minify: false,/);
  assert.match(refreshed, /BUILD SIZE: Updated documentation\./);
  assert.equal(await annotateExampleConfig(refreshed, nextTemplate), refreshed);
  assert.equal(refreshed.match(/tinybuild:reference:bundler:start/g).length, 1);
});

test("disabled section references can be uncommented into valid config objects", async () => {
  const annotated = await annotateExampleConfig(
    "export default {bundler:false,server:false};",
    template,
  );
  for (const section of ["bundler", "server"]) {
    const block = annotated
      .split(`// tinybuild:reference:${section}:start`)[1]
      .split(`// tinybuild:reference:${section}:end`)[0];
    const replacement = block
      .slice(block.indexOf(`// ${section}: {`))
      .replace(/^[ \t]*\/\/ ?/gm, "");
    await executable(`export default {${replacement}};`);
    assert.match(
      replacement,
      section === "bundler" ? /\/\/ bundleESM:/ : /\/\/ delay:/,
    );
  }
});

test("reference generation refuses invalid or indirect config exports", async () => {
  await assert.rejects(
    annotateExampleConfig("export default {", template),
    /invalid config/,
  );
  await assert.rejects(
    annotateExampleConfig("export default makeConfig();", template),
    /default-exported config object/,
  );
  await assert.rejects(
    annotateExampleConfig("export default {};", "export default {};"),
    /reference objects/,
  );
});
