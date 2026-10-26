import fs from "node:fs/promises";
import path from "node:path";
import { assertConfig } from "./config-options.js";
import { resolveNativeConfig } from "./native-config.js";
import { packager } from "./packager.js";
import { packageNative } from "./native.js";
import { serve } from "./node_server/server.js";

import { validateChecks } from "./checks-config.js";

export async function checkProject(
  input,
  { cwd = process.cwd(), stage = false, signal, onWarning } = {},
) {
  cwd = path.resolve(cwd);
  assertConfig(input, { onWarning });
  validateChecks(input.checks);
  const checks = input.checks || {};
  const config = resolveNativeConfig(input);
  const steps = [];
  let app, server;
  try {
    const bundler =
      config.bundler === false
        ? false
        : (Array.isArray(config.bundler)
            ? config.bundler
            : [config.bundler || {}]
          ).map((value) => ({ ...value, autoInstall: false }));
    app = await packager(
      {
        ...config,
        profile: undefined,
        bundler,
        build: true,
        serve: false,
        server: false,
        tasks: undefined,
        native: undefined,
        electron: false,
        tauri: false,
        mobile: false,
        stats: false,
      },
      { cwd, watch: false, signal, onWarning },
    );
    steps.push({ name: "build", ok: true, skipped: bundler === false });
    for (const file of checks.files || []) {
      const absolute = path.resolve(cwd, file);
      const real = await fs.realpath(absolute);
      const relative = path.relative(await fs.realpath(cwd), real);
      if (
        relative === ".." ||
        relative.startsWith(".." + path.sep) ||
        path.isAbsolute(relative)
      )
        throw new Error("Checked file escapes project: " + file);
      if (!(await fs.stat(real)).isFile())
        throw new Error("Expected a file: " + file);
      steps.push({ name: "file", path: file, ok: true });
    }
    if (checks.urls?.length) {
      if (config.server === false)
        throw new Error("checks.urls requires server settings");
      // A private temporary listener does not interrupt an existing dev server.
      server = await serve({
        ...config.server,
        cwd,
        host: "127.0.0.1",
        port: 0,
        open: false,
        hotreload: false,
        debug: false,
        onRequest: undefined,
        python: false,
        python_node: undefined,
        pythonUrl: undefined,
        production: config.production ?? config.server?.production,
      });
      for (const check of checks.urls) {
        const url = new URL(check.path, server.url);
        if (url.origin !== new URL(server.url).origin)
          throw new Error("Check URL must stay on the temporary server");
        const abort = AbortSignal.timeout(checks.timeout || 5000);
        const response = await fetch(url, {
          redirect: "manual",
          signal: signal ? AbortSignal.any([signal, abort]) : abort,
        });
        try {
          if (response.status !== (check.status ?? 200))
            throw new Error(
              "URL " +
                check.path +
                " returned " +
                response.status +
                "; expected " +
                (check.status ?? 200),
            );
          if (check.includes !== undefined) {
            let bytes = 0,
              text = "";
            const decoder = new TextDecoder();
            for await (const chunk of response.body || []) {
              bytes += chunk.length;
              if (bytes > 2 * 1024 * 1024)
                throw new Error("URL check body exceeds 2 MiB: " + check.path);
              text += decoder.decode(chunk, { stream: true });
            }
            text += decoder.decode();
            if (!text.includes(check.includes))
              throw new Error(
                "URL " + check.path + " is missing expected text",
              );
          }
        } finally {
          await response.body?.cancel().catch(() => {});
        }
        steps.push({ name: "url", path: check.path, ok: true });
      }
    }
    if (stage) {
      const target = (value) =>
        value
          ? {
              ...(typeof value === "object" ? value : {}),
              action: "stage",
              liveReload: false,
              watch: false,
              target: undefined,
              flavor: undefined,
            }
          : false;
      const native = await packageNative(
        {
          ...config,
          profile: undefined,
          native: config.native
            ? {
                ...config.native,
                targets: undefined,
                profiles: undefined,
                profile: undefined,
                devUrl: false,
                signing: undefined,
              }
            : undefined,
          server: false,
          electron:
            typeof config.electron === "string"
              ? { ...target(config.electron), directory: config.electron }
              : target(config.electron),
          tauri: target(config.tauri),
          mobile: config.mobile
            ? Object.fromEntries(
                Object.entries(config.mobile).map(([name, value]) => [
                  name,
                  target(value),
                ]),
              )
            : false,
        },
        app.bundles,
        { cwd, signal },
      );
      await native.close?.();
      steps.push({
        name: "native-stage",
        ok: true,
        skipped:
          !config.electron &&
          !config.tauri &&
          !Object.values(config.mobile || {}).some(Boolean),
      });
    }
    return {
      ok: true,
      steps,
      native: {
        staging: stage ? "checked" : "not-requested",
        sdk: "not-run",
        device: "not-run",
        signing: "not-run",
      },
    };
  } finally {
    try {
      await server?.close();
    } finally {
      await app?.close();
    }
  }
}
