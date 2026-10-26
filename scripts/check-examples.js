import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runTinybuild } from "../tinybuild/cli.js";
import { serve } from "../tinybuild/node_server/server.js";
import { loadConfig } from "../tinybuild/config.js";
import { request } from "../tests/helpers.js";
import { startTasks } from "../tinybuild/tasks.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import { gunzipSync } from "node:zlib";
const execute = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));

async function configs(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      ![
        "node_modules",
        "dist",
        "android",
        "ios",
        "src-tauri",
        "electron",
        "mobile_dist",
      ].includes(entry.name)
    )
      output.push(...(await configs(path.join(directory, entry.name))));
    else if (entry.name === "tinybuild.config.js")
      output.push(path.join(directory, entry.name));
  }
  return output;
}
export async function checkExamples({ inspectPage } = {}) {
  const remote = http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: "Hello from the proxied backend" }));
    } else res.end('export const message="Example remote module";');
  });
  const echoes = new WebSocketServer({ server: remote });
  echoes.on("connection", (socket) =>
    socket.on("message", (value, binary) => socket.send(value, { binary })),
  );
  remote.listen(0, "127.0.0.1");
  await once(remote, "listening");
  const previous = process.env.TINYBUILD_EXAMPLE_REMOTE;
  const previousBackend = process.env.TINYBUILD_EXAMPLE_BACKEND;
  process.env.TINYBUILD_EXAMPLE_REMOTE =
    "http://127.0.0.1:" + remote.address().port + "/message.js";
  process.env.TINYBUILD_EXAMPLE_BACKEND =
    "http://127.0.0.1:" + remote.address().port;
  const passed = [];
  const failures = [];
  try {
    for (const filename of await configs(path.join(repository, "examples"))) {
      const label = path
        .relative(repository, path.dirname(filename))
        .split(path.sep)
        .join("/");
      const scratch = await fs.mkdtemp(
        path.join(os.tmpdir(), "tinybuild-example-"),
      );
      let workspace;
      try {
        await fs.cp(path.dirname(filename), scratch, {
          recursive: true,
          filter: (source) =>
            !path
              .relative(path.dirname(filename), source)
              .split(path.sep)
              .some((part) =>
                [
                  "dist",
                  "node_modules",
                  "android",
                  "ios",
                  "electron",
                  "src-tauri",
                  "mobile_dist",
                ].includes(part),
              ),
        });
        const config = await loadConfig(filename, repository, true);
        if (label === "examples/task_workspace") {
          const probe = http.createServer();
          probe.listen(0, "127.0.0.1");
          await once(probe, "listening");
          const port = probe.address().port;
          await new Promise((resolve) => probe.close(resolve));
          config.tasks.api = {
            ...config.tasks.api,
            env: { PORT: String(port) },
            ready: { url: "http://127.0.0.1:" + port + "/ready" },
          };
          config.server.proxy = { "/api": "http://127.0.0.1:" + port };
          workspace = await startTasks(config.tasks, {
            cwd: scratch,
            silent: true,
          });
        }
        const app = await runTinybuild(
          {
            ...config,
            cfgpath: filename,
            build: true,
            bundler:
              config.bundler === false
                ? false
                : Array.isArray(config.bundler)
                  ? config.bundler.map((value) => ({
                      ...value,
                      autoInstall: false,
                    }))
                  : { ...config.bundler, autoInstall: false },
          },
          { cwd: scratch, native: { dryRun: true } },
        );
        await app.close();
        const groups = app.bundles;
        if (
          config.bundler !== false &&
          (!groups.length ||
            !groups.some((group) =>
              Object.values(group).some(
                (result) => result?.metafile || result?.outputs,
              ),
            ))
        )
          throw new Error("No build outputs");
        for (const group of groups)
          for (const result of Object.values(group))
            if (result?.metafile)
              for (const output of Object.keys(result.metafile.outputs))
                await fs.access(path.resolve(scratch, output));
        for (const group of groups)
          for (const result of Object.values(group))
            for (const filename of result?.gzipFiles || [])
              if (
                !gunzipSync(await fs.readFile(filename)).equals(
                  await fs.readFile(filename.slice(0, -3)),
                )
              )
                throw new Error(
                  "Gzip output does not match original: " + filename,
                );
        // Browser examples must also serve their HTML and local asset references.
        if (config.server !== false) {
          await fs.access(
            path.resolve(
              scratch,
              config.server?.root || ".",
              config.server?.startpage || "index.html",
            ),
          );
          const server = await serve({
            cwd: scratch,
            ...config.server,
            python: false,
            hotreload: false,
            host: "127.0.0.1",
            port: 0,
          });
          try {
            const page = await request(server.SERVER);
            if (page.status !== 200)
              throw new Error("Home returned " + page.status);
            if (label === "examples/gzip_target") {
              const compressed = await request(server.SERVER, "/", {
                headers: { "Accept-Encoding": "gzip" },
              });
              if (
                compressed.headers["content-encoding"] !== "gzip" ||
                !gunzipSync(compressed.bytes).equals(page.bytes)
              )
                throw new Error(
                  "Compressed example HTML was not served correctly",
                );
            }
            for (const match of page.body.matchAll(
              /(?:src|href)=["']([^"']+)["']/g,
            )) {
              if (
                /^(?:https?:|#|data:)/.test(match[1]) ||
                !/\.(?:js|css|png|svg|ico)(?:\?|$)/.test(match[1])
              )
                continue;
              const resource = new URL(match[1], "http://localhost/").pathname;
              const response = await request(server.SERVER, resource);
              if (response.status !== 200)
                throw new Error(
                  "Missing HTML asset " + resource + ": " + response.status,
                );
            }
            const checks = await fs
              .readFile(path.join(scratch, "checks.json"), "utf8")
              .then(JSON.parse, (error) => {
                if (error.code === "ENOENT") return [];
                throw error;
              });
            for (const check of checks) {
              const response = await request(server.SERVER, check.path, {
                headers: check.headers,
              });
              if (
                response.status !== check.status ||
                (check.includes && !response.body.includes(check.includes))
              )
                throw new Error("Demo route check failed: " + check.path);
            }
            if (inspectPage) await inspectPage({ label, url: server.url });
          } finally {
            await server.close();
          }
        }
        if (label === "examples/node_worker") {
          const result = await execute(process.execPath, ["dist/index.js"], {
            cwd: scratch,
            timeout: 5000,
          });
          if (!result.stdout.includes("42"))
            throw new Error("Node worker did not return its result");
        }
        if (label === "examples/library") {
          const library = await import(
            pathToFileURL(path.join(scratch, "dist/index.esm.js")).href
          );
          if (library.greet("demo") !== "Hello, demo")
            throw new Error("Library consumer failed");
        }
        passed.push(label);
        console.log("PASS " + label);
      } catch (error) {
        failures.push({ label, error });
        console.error("FAIL " + label + ": " + error.message);
      } finally {
        await workspace?.close();
        if (
          path.dirname(scratch) !== path.resolve(os.tmpdir()) ||
          !path.basename(scratch).startsWith("tinybuild-example-")
        )
          throw new Error("Unsafe example cleanup");
        await fs.rm(scratch, { recursive: true, force: true });
      }
    }
  } finally {
    previous === undefined
      ? delete process.env.TINYBUILD_EXAMPLE_REMOTE
      : (process.env.TINYBUILD_EXAMPLE_REMOTE = previous);
    previousBackend === undefined
      ? delete process.env.TINYBUILD_EXAMPLE_BACKEND
      : (process.env.TINYBUILD_EXAMPLE_BACKEND = previousBackend);
    for (const socket of echoes.clients) socket.terminate();
    await new Promise((resolve) => echoes.close(resolve));
    await new Promise((resolve) => remote.close(resolve));
  }
  if (failures.length)
    throw new AggregateError(
      failures.map((failure) => failure.error),
      failures.length + " examples failed",
    );
  console.log(
    passed.length + " examples passed (native commands staged/dry-run).",
  );
  return passed;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  checkExamples().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
