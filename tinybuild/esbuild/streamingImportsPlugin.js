import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { createHash, randomUUID } from "node:crypto";

export function httpGet(
  url,
  { timeout = 15000, maxBytes = 20 * 1024 * 1024, redirects = 5 } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (!["http:", "https:"].includes(target.protocol))
      return reject(new Error("Unsupported import protocol"));
    const request = (target.protocol === "https:" ? https : http).get(
      target,
      (response) => {
        if (
          [301, 302, 303, 307, 308].includes(response.statusCode) &&
          response.headers.location
        ) {
          response.resume();
          if (!redirects) return reject(new Error("Too many import redirects"));
          return httpGet(new URL(response.headers.location, target), {
            timeout,
            maxBytes,
            redirects: redirects - 1,
          }).then(resolve, reject);
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          return reject(
            new Error(
              "Import request failed: HTTP " +
                response.statusCode +
                " " +
                target,
            ),
          );
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            reject(new Error("Import exceeds maximum size"));
            response.destroy();
            request.destroy();
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          buffer.url = target.href;
          buffer.contentType = response.headers["content-type"] || "";
          resolve(buffer);
        });
      },
    );
    request.setTimeout(timeout, () =>
      request.destroy(new Error("Import request timed out")),
    );
    request.on("error", reject);
  });
}
export function createStreamingImportsPlugin(options = {}) {
  const inFlight = new Map();
  return {
    name: "streamImports",
    setup(build) {
      const cwd = build.initialOptions.absWorkingDir || process.cwd();
      const directory = path.resolve(
        cwd,
        options.cacheDir || "node_modules/.cache/tinybuild/remote",
      );
      async function fetchCached(rawURL) {
        const url = new URL(rawURL);
        url.hash = "";
        const key = createHash("sha256").update(url.href).digest("hex");
        if (inFlight.has(key)) return inFlight.get(key);
        const task = (async () => {
          const filename = path.join(directory, key + ".json");
          if (!options.refresh || options.frozen) {
            try {
              return JSON.parse(await fs.readFile(filename, "utf8"));
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
          }
          if (options.frozen)
            throw new Error(
              "Remote import is not cached in frozen mode: " + url.href,
            );
          const bytes = await httpGet(url, options);
          const cached = {
            url: bytes.url,
            contentType: bytes.contentType,
            body: bytes.toString("base64"),
          };
          await fs.mkdir(directory, { recursive: true });
          const temporary =
            filename + "." + process.pid + "." + randomUUID() + ".tmp";
          await fs.writeFile(temporary, JSON.stringify(cached));
          await fs.rename(temporary, filename);
          return cached;
        })();
        inFlight.set(key, task);
        try {
          return await task;
        } finally {
          inFlight.delete(key);
        }
      }
      async function resolveURL(url) {
        const cached = await fetchCached(url);
        return {
          path: cached.url,
          namespace: "tinybuild-http",
          pluginData: { cached },
        };
      }
      build.onResolve({ filter: /^https?:\/\// }, (args) =>
        resolveURL(new URL(args.path).href),
      );
      build.onResolve({ filter: /.*/, namespace: "tinybuild-http" }, (args) =>
        resolveURL(new URL(args.path, args.importer).href),
      );
      build.onLoad(
        { filter: /.*/, namespace: "tinybuild-http" },
        async (args) => {
          const cached =
            args.pluginData?.cached || (await fetchCached(args.path));
          const extension = path.extname(new URL(cached.url).pathname);
          const loader =
            build.initialOptions.loader?.[extension] ||
            {
              ".js": "js",
              ".mjs": "js",
              ".cjs": "js",
              ".ts": "ts",
              ".tsx": "tsx",
              ".jsx": "jsx",
              ".json": "json",
              ".css": "css",
            }[extension] ||
            (cached.contentType.includes("css")
              ? "css"
              : cached.contentType.includes("json")
                ? "json"
                : "js");
          // Redirected modules resolve children against their final location.
          const contents = Buffer.from(cached.body, "base64");
          return { contents, loader };
        },
      );
    },
  };
}
export const streamingImportsPlugin = createStreamingImportsPlugin();
