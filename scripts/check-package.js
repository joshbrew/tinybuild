import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../", import.meta.url));
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "tinybuild-package-"));
const npmCLI = [
  process.env.npm_execpath,
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
].find((file) => file?.endsWith("npm-cli.js") && existsSync(file));
if (!npmCLI) throw new Error("Run this check through npm run test:package");
function npm(args, cwd) {
  return execFileSync(process.execPath, [npmCLI, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
try {
  const packed = JSON.parse(
    npm(["pack", "--json", "--pack-destination", scratch], repository),
  )[0];
  const readme = await fs.readFile(path.join(repository, "README.md"), "utf8");
  for (const [, source] of readme.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) {
    if (!source.startsWith("https://"))
      throw new Error(
        "README images need absolute HTTPS URLs for npm: " + source,
      );
    const prefix =
      "https://raw.githubusercontent.com/joshbrew/tinybuild/master/";
    if (source.startsWith(prefix))
      await fs.access(path.join(repository, source.slice(prefix.length)));
  }
  for (const file of packed.files)
    if (
      /^(tests|scripts|examples|\.github)\//.test(file.path) ||
      /\.(jks|pem|key)$/.test(file.path)
    )
      throw new Error("Unexpected published file: " + file.path);
  await fs.writeFile(
    path.join(scratch, "package.json"),
    '{"name":"tinybuild-installed-smoke","private":true,"type":"module"}',
  );
  npm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      path.join(scratch, packed.filename),
    ],
    scratch,
  );
  const smoke =
    'const n=process.listenerCount("SIGINT");const {bundle,developmentQR,nativeApp,startTasks}=await import("tinybuild");if(n!==process.listenerCount("SIGINT"))throw Error("Import side effect");await bundle({entryPoints:["index.js"],outfile:"dist/index",autoInstall:false});if(!(await developmentQR("http://localhost:8080")).includes("<svg"))throw Error("QR helper missing");if(!nativeApp({id:"com.example.app"}).native)throw Error("Native macro missing");await(await startTasks({})).close();const {createHotContext}=await import("tinybuild/client/hot");if(typeof createHotContext!=="function")throw Error("Client export missing");';
  await fs.writeFile(path.join(scratch, "index.js"), "export const value=42;");
  execFileSync(process.execPath, ["--input-type=module", "-e", smoke], {
    cwd: scratch,
    stdio: "pipe",
  });
  const cli = path.join(
    scratch,
    "node_modules/tinybuild/tinybuild/bin/global.js",
  );
  const emptyProject = path.join(scratch, "empty-project");
  await fs.mkdir(emptyProject);
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import fs from 'node:fs/promises';
    const {runTinybuild}=await import('tinybuild');
    const app=await runTinybuild(['dev','--port','0']);
    try {
      if(!(await fetch(app.server.url)).ok) throw Error('Fresh app is not served');
      if(!(await fetch(app.server.url+'/dist/index.js')).ok) throw Error('Fresh bundle is not served');
      for(const file of ['tinybuild.config.js','index.html','index.js']) await fs.access(file);
    } finally { await app.close(); }
  `,
    ],
    { cwd: emptyProject, stdio: "pipe", timeout: 15000 },
  );
  console.log(
    "Installed walkthrough passed: empty-folder build, serve and shutdown",
  );
  const help = execFileSync(process.execPath, [cli, "help"], {
    cwd: scratch,
    encoding: "utf8",
  });
  if (!help.includes("blobWorkers"))
    throw new Error("Installed CLI help missing options");
  const options = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, "options", "--search", "worker", "--json"],
      { cwd: scratch, encoding: "utf8" },
    ),
  );
  if (
    options.schemaVersion !== 1 ||
    !options.data.some(
      (item) => item.path === "bundler.blobWorkers" && item.type,
    )
  )
    throw new Error("Installed option documentation is missing");
  execFileSync(
    process.execPath,
    [
      cli,
      "init",
      "--example",
      "webworkers",
      "--dir",
      "starter",
      "--agentGuide",
      "--json",
    ],
    { cwd: scratch, stdio: "pipe" },
  );
  const checked = JSON.parse(
    execFileSync(process.execPath, [cli, "check", "--json"], {
      cwd: path.join(scratch, "starter"),
      encoding: "utf8",
    }),
  );
  if (!checked.ok)
    throw new Error("Installed starter did not pass its project check");
  await fs.access(path.join(scratch, "starter/TINYBUILD_AGENT.md"));
  const generated = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, "init", "--worker", "src/flow.Worker", "--typescript", "--json"],
      { cwd: path.join(scratch, "starter"), encoding: "utf8" },
    ),
  );
  if (!generated.ok || !generated.data.files.includes("src/flow.d.Worker.ts"))
    throw new Error("Installed worker scaffolding is missing");
  await fs.access(path.join(scratch, "starter/src/flow.Worker.ts"));
  const typescriptVersion = JSON.parse(
    await fs.readFile(
      path.join(repository, "node_modules/typescript/package.json"),
      "utf8",
    ),
  ).version;
  npm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-dev",
      "typescript@" + typescriptVersion,
    ],
    scratch,
  );
  // Follow first-time setup with the packed installation, without repository
  // module resolution, SDKs or globally installed tinybuild commands.
  for (const example of [
    "default",
    "worker_types",
    "server_workflow",
    "native_shells",
  ]) {
    const directory = path.join(scratch, example);
    const call = (args) =>
      execFileSync(process.execPath, [cli, ...args], {
        cwd: directory,
        encoding: "utf8",
      });
    execFileSync(
      process.execPath,
      [cli, "init", "--example", example, "--dir", example, "--json"],
      { cwd: scratch, stdio: "pipe" },
    );
    const plan = JSON.parse(call(["preview", "--json"]));
    if (!plan.ok) throw Error(example + " starter preview failed");
    const result = JSON.parse(
      call([
        "check",
        "--json",
        ...(example === "native_shells" ? ["--stage"] : []),
        ...(example === "server_workflow"
          ? [
              "--config",
              JSON.stringify({
                checks: {
                  urls: [
                    {
                      path: "/api/message",
                      includes: "Dev and production are ready",
                    },
                  ],
                },
              }),
            ]
          : []),
      ]),
    );
    if (!result.ok) throw Error(example + " installed walkthrough failed");
    const report = JSON.parse(call(["doctor", "--report", "--json"]));
    if (!report.data.runtime.esbuild || report.command !== "doctor")
      throw Error("Installed support report missing");
    if (example === "worker_types")
      execFileSync(
        process.execPath,
        [
          path.join(scratch, "node_modules/typescript/bin/tsc"),
          "-p",
          "tsconfig.json",
        ],
        { cwd: directory, stdio: "pipe" },
      );
    console.log("Installed walkthrough passed: " + example);
  }
  const bin = await fs.readFile(cli, "utf8");
  if (!bin.startsWith("#!/usr/bin/env node\n"))
    throw new Error("CLI shebang must use LF");
  execFileSync(
    process.execPath,
    [
      cli,
      "config",
      "--set",
      JSON.stringify({ server: { port: 8081 } }),
      "--yes",
    ],
    { cwd: scratch, stdio: "pipe" },
  );
  const configured = await fs.readFile(
    path.join(scratch, "tinybuild.config.js"),
    "utf8",
  );
  if (
    !configured.includes("tinybuild:config:start") ||
    !configured.includes("mobile=android")
  )
    throw new Error("Installed configurator lost annotated defaults");
  execFileSync(process.execPath, [cli, "build"], {
    cwd: scratch,
    stdio: "pipe",
  });
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'const {createWorkerPool}=await import("tinybuild/client/workers");const {createNativeBridge}=await import("tinybuild/client/native");if(typeof createWorkerPool!=="function"||!createNativeBridge)throw Error("Optional client exports missing");',
    ],
    { cwd: scratch, stdio: "pipe" },
  );
  console.log(
    "Packed package installs, imports, builds, and runs its CLI successfully.",
  );
} finally {
  if (
    path.dirname(scratch) !== path.resolve(os.tmpdir()) ||
    !path.basename(scratch).startsWith("tinybuild-package-")
  )
    throw new Error("Unsafe package cleanup");
  await fs.rm(scratch, { recursive: true, force: true });
}
