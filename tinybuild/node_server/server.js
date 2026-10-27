import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { HotReload, addHotReloadClient } from "./hotreload/hotreload.js";
import { PythonRelay, PythonClient } from "./relay/python_relay.js";
import { proxyRequest, proxyWebSocket } from "./proxy.js";
import {
  serverRoot,
  staticCacheControl,
  validateServerTools,
} from "../server-tools.js";
import {
  compressibleFile,
  encodingPreferences,
  varyEncoding,
} from "../compression.js";

export const defaultServer = {
  debug: false,
  protocol: "http",
  host: "localhost",
  port: 8080,
  startpage: "index.html",
  hotreload: 5000,
  delay: 150,
  hotreloadExtensions: ["css", "sass", "scss", "less"],
  python: false,
  readinessPath: "/_tinybuild/ready",
  shutdownTimeout: 5000,
  requestTimeout: 30000,
  precompressed: true,
  portRetries: 0,
  responseTimeout: 30000,
};
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
};
const routeCache = new WeakMap();
export function findRouteCfg(rawPathname, routes) {
  const pathname = rawPathname.split(/[?#]/)[0];
  if (Object.hasOwn(routes, pathname))
    return { def: routes[pathname], params: {} };
  let compiled = routeCache.get(routes);
  if (!compiled) {
    compiled = Object.entries(routes)
      .filter(([pattern]) => pattern.includes("/:"))
      .map(([pattern, def]) => {
        const names = [];
        const expression = pattern
          .split("/")
          .filter(Boolean)
          .map((part) => {
            if (part.startsWith(":")) {
              names.push(part.slice(1));
              return "([^/]+)";
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("/");
        return { regex: new RegExp("^/" + expression + "/?$"), names, def };
      });
    routeCache.set(routes, compiled);
  }
  for (const item of compiled) {
    const match = pathname.match(item.regex);
    if (match)
      return {
        def: item.def,
        params: Object.fromEntries(
          item.names.map((name, index) => [
            name,
            decodeURIComponent(match[index + 1]),
          ]),
        ),
      };
  }
  return null;
}
function inside(root, filename) {
  const relative = path.relative(root, filename);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
function send(response, status, body = "", headers = {}, method) {
  if (response.writableEnded || response.destroyed) return;
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    ...(status === 304 ? {} : { "Content-Length": data.length }),
    ...headers,
  });
  response.end(method === "HEAD" ? undefined : data);
}
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!match || !size) return null;
  let start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  let end = match[2] && match[1] ? Number(match[2]) : size - 1;
  if (
    (!match[1] && (!match[2] || Number(match[2]) === 0)) ||
    start > end ||
    start >= size
  )
    return null;
  return { start, end: Math.min(end, size - 1) };
}
export function createRequestHandler(config = {}, sockets = {}) {
  const cfg = { ...defaultServer, ...config };
  const cwd = path.resolve(cfg.cwd || process.cwd());
  const root = serverRoot(cfg, cwd);
  let ready = true;
  const mounts = cfg.staticRoots || { "/": root };
  const reloadClient =
    cfg.hotreload && !cfg.production
      ? Buffer.from(
          addHotReloadClient(
            "",
            "/hotreload",
            cfg.hotreloadTransport,
            cfg.socket_protocol,
          ),
        )
      : undefined;
  async function errorPage(request, response) {
    if (
      cfg.spa &&
      ["GET", "HEAD"].includes(request.method) &&
      request.headers.accept?.includes("text/html") &&
      !path.extname(new URL(request.url, "http://localhost").pathname)
    ) {
      const filename = path.resolve(
        root,
        typeof cfg.spa === "string" ? cfg.spa : cfg.startpage,
      );
      try {
        if (inside(await fs.realpath(root), await fs.realpath(filename))) {
          return serveFile(request, response, filename, false, {
            "Cache-Control": "no-store",
          });
        }
      } catch {}
    }
    const definition = cfg.routes?.["/404"];
    if (definition && typeof definition === "object" && definition.template)
      return send(
        response,
        404,
        definition.template,
        {
          ...cfg.headers,
          ...definition.headers,
          "Content-Type": "text/html; charset=utf-8",
        },
        request.method,
      );
    if (definition && typeof definition === "object" && definition.redirect)
      return send(
        response,
        cfg.production ? 301 : 302,
        "",
        { Location: definition.redirect },
        request.method,
      );
    const filename =
      typeof definition === "string"
        ? definition
        : definition?.path || cfg.errpage;
    if (filename) {
      try {
        return send(
          response,
          404,
          await fs.readFile(path.resolve(cwd, filename)),
          { ...cfg.headers, "Content-Type": "text/html; charset=utf-8" },
          request.method,
        );
      } catch {}
    }
    send(response, 404, "Not found", cfg.headers, request.method);
  }
  async function serveFile(
    request,
    response,
    filename,
    trusted = false,
    routeHeaders = {},
  ) {
    let checkedRoot;
    if (!trusted) {
      const mountRoot = Object.values(mounts)
        .map((value) => path.resolve(cwd, value))
        .find((value) => inside(value, filename));
      if (!mountRoot)
        return send(response, 403, "Forbidden", cfg.headers, request.method);
      try {
        checkedRoot = await fs.realpath(mountRoot);
        if (!inside(checkedRoot, await fs.realpath(filename)))
          return send(response, 403, "Forbidden", cfg.headers, request.method);
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR")
          return errorPage(request, response);
        throw error;
      }
    }
    let stat;
    try {
      stat = await fs.stat(filename);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR")
        return errorPage(request, response);
      throw error;
    }
    if (!stat.isFile()) return errorPage(request, response);
    const extension = path.extname(filename).toLowerCase();
    const headers = {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": staticCacheControl(
        cfg,
        new URL(request.url, "http://localhost").pathname,
        filename,
      ),
      "X-Content-Type-Options": "nosniff",
      ...cfg.headers,
      ...routeHeaders,
    };
    if (cfg.pwa && filename === path.resolve(serverRoot(cfg, cwd), cfg.pwa))
      headers["Service-Worker-Allowed"] = "/";
    const preferences = encodingPreferences(request.headers["accept-encoding"]);
    const eligible = cfg.precompressed !== false && compressibleFile(filename);
    if (eligible) varyEncoding(headers);
    if (extension === ".html" && cfg.hotreload && !cfg.production) {
      if (!preferences.identity)
        return send(
          response,
          406,
          "No acceptable encoding",
          headers,
          request.method,
        );
      if (request.method === "HEAD")
        return send(
          response,
          200,
          "",
          { ...headers, "Content-Length": stat.size + reloadClient.length },
          request.method,
        );
      const data = Buffer.concat([await fs.readFile(filename), reloadClient]);
      return send(response, 200, data, headers, request.method);
    }
    const modified = stat.mtime;
    let compressed = false;
    if (
      eligible &&
      preferences.gzip > 0 &&
      preferences.gzip >= preferences.identity &&
      (!request.headers.range || !preferences.identity)
    ) {
      const gzipFile = filename + ".gz";
      try {
        const gzipStat = await fs.lstat(gzipFile);
        // Ignore stale, larger or linked sidecars. Existing files always remain a fallback.
        if (
          gzipStat.isFile() &&
          gzipStat.mtimeMs >= stat.mtimeMs &&
          (gzipStat.size < stat.size || !preferences.identity) &&
          inside(
            checkedRoot || (await fs.realpath(path.dirname(filename))),
            await fs.realpath(gzipFile),
          )
        ) {
          filename = gzipFile;
          stat = gzipStat;
          compressed = true;
          headers["Content-Encoding"] = "gzip";
        }
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      }
    }
    if (!compressed && !preferences.identity)
      return send(
        response,
        406,
        "No acceptable encoding",
        headers,
        request.method,
      );
    const etag =
      '"' + stat.size + "-" + stat.mtimeMs + (compressed ? "-gzip" : "") + '"';
    Object.assign(headers, {
      ETag: etag,
      "Last-Modified": modified.toUTCString(),
      "Accept-Ranges": compressed ? "none" : "bytes",
    });
    if (
      request.headers["if-none-match"] === etag ||
      (!request.headers["if-none-match"] &&
        request.headers["if-modified-since"] &&
        modified.getTime() <
          Date.parse(request.headers["if-modified-since"]) + 1000)
    )
      return send(response, 304, "", headers, request.method);
    let range;
    if (request.headers.range && !compressed) {
      range = parseRange(request.headers.range, stat.size);
      if (!range)
        return send(
          response,
          416,
          "",
          { ...headers, "Content-Range": "bytes */" + stat.size },
          request.method,
        );
      headers["Content-Range"] =
        "bytes " + range.start + "-" + range.end + "/" + stat.size;
    }
    headers["Content-Length"] = range ? range.end - range.start + 1 : stat.size;
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === "HEAD") return response.end();
    await pipeline(createReadStream(filename, range), response);
  }
  const handler = async (request, response) => {
    if (cfg.debug || cfg.onRequest) {
      const started = performance.now();
      let logged = false;
      const completed = () => {
        if (logged) return;
        logged = true;
        let pathname;
        try {
          pathname = new URL(request.url, "http://localhost").pathname;
        } catch {
          pathname = "<invalid-url>";
        }
        const record = {
          method: request.method,
          path: pathname,
          status: response.writableFinished ? response.statusCode : 499,
          durationMs: Math.round((performance.now() - started) * 100) / 100,
        };
        try {
          if (cfg.debug)
            (outputContext.getStore()?.machine ? console.error : console.log)(
              JSON.stringify(record),
            );
          cfg.onRequest?.(record);
        } catch (error) {
          try {
            cfg.onError?.(error);
          } catch {}
        }
      };
      response.once("finish", completed);
      response.once("close", completed);
    }
    if (cfg.responseTimeout)
      response.setTimeout(cfg.responseTimeout, () => {
        if (response.headersSent) response.destroy();
        else
          send(
            response,
            504,
            "Response timed out",
            { Connection: "close", "Cache-Control": "no-store" },
            request.method,
          );
      });
    try {
      const url = new URL(request.url, "http://localhost");
      // Reject malformed escapes before route callbacks; decode static paths exactly once.
      const decoded = decodeURIComponent(url.pathname);
      if (url.pathname === "/hotreload/events" && sockets.hotreload)
        return sockets.hotreload.handleEvents(request, response);
      if (url.pathname === cfg.readinessPath) {
        if (!["GET", "HEAD"].includes(request.method))
          return send(
            response,
            405,
            "Method not allowed",
            { Allow: "GET, HEAD" },
            request.method,
          );
        let healthy = ready;
        try {
          if (healthy && cfg.isReady) healthy = Boolean(await cfg.isReady());
        } catch (error) {
          healthy = false;
          try {
            cfg.onError?.(error);
          } catch {}
        }
        return send(
          response,
          healthy ? 200 : 503,
          JSON.stringify({ ready: healthy }),
          { "Content-Type": "application/json", "Cache-Control": "no-store" },
          request.method,
        );
      }
      if (cfg.redirect)
        return send(
          response,
          cfg.redirectStatus || (cfg.production ? 301 : 302),
          "",
          { ...cfg.headers, Location: cfg.redirect },
          request.method,
        );
      const proxy = Object.keys(cfg.proxy || {})
        .sort((a, b) => b.length - a.length)
        .find(
          (prefix) =>
            url.pathname === prefix ||
            url.pathname.startsWith(prefix.replace(/\/$/, "") + "/"),
        );
      if (proxy)
        return await proxyRequest(
          request,
          response,
          url,
          proxy,
          cfg.proxy[proxy],
          cfg.headers,
        );
      const match = cfg.routes && findRouteCfg(url.pathname, cfg.routes);
      if (match) {
        request.params = match.params;
        const route =
          typeof match.def === "string"
            ? { path: match.def }
            : typeof match.def === "function"
              ? { onrequest: match.def }
              : match.def;
        for (const [name, value] of Object.entries({
          ...cfg.headers,
          ...route.headers,
        }))
          response.setHeader(name, value);
        if (
          route.onrequest &&
          ((await route.onrequest(request, response)) ||
            response.writableEnded ||
            response.destroyed)
        )
          return;
        if (route.template !== undefined)
          return send(
            response,
            route.status || 200,
            route.template,
            {
              ...cfg.headers,
              ...route.headers,
              "Content-Type": "text/html; charset=utf-8",
            },
            request.method,
          );
        if (route.redirect)
          return send(
            response,
            route.status || (cfg.production ? 301 : 302),
            "",
            { ...cfg.headers, ...route.headers, Location: route.redirect },
            request.method,
          );
        if (route.path)
          return await serveFile(
            request,
            response,
            path.resolve(cwd, route.path),
            true,
            route.headers,
          );
      }
      if (!["GET", "HEAD"].includes(request.method))
        return send(
          response,
          405,
          "Method not allowed",
          { Allow: "GET, HEAD" },
          request.method,
        );
      const segments = decoded.replaceAll("\\", "/").split("/");
      if (
        segments.some(
          (segment) =>
            segment.startsWith(".") ||
            [
              "node_modules",
              "package.json",
              "package-lock.json",
              "tinybuild.config.js",
            ].includes(segment),
        ) ||
        /\.(?:pem|key|pfx|jks|p12|keystore)(?:\.gz)?$/i.test(decoded) ||
        /\.env(?:\.|$)/i.test(path.basename(decoded))
      )
        return send(response, 403, "Forbidden", cfg.headers, request.method);
      const prefix = Object.keys(mounts)
        .sort((a, b) => b.length - a.length)
        .find(
          (value) =>
            value === "/" ||
            decoded === value ||
            decoded.startsWith(value.replace(/\/$/, "") + "/"),
        );
      if (!prefix) return errorPage(request, response);
      const base = path.resolve(cwd, mounts[prefix]);
      const relative =
        decoded === "/"
          ? cfg.startpage
          : decoded
              .slice(prefix === "/" ? 1 : prefix.length)
              .replace(/^\//, "");
      return await serveFile(request, response, path.resolve(base, relative));
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status =
        error.status ||
        (error instanceof URIError || error.code === "ERR_INVALID_URL"
          ? 400
          : 500);
      try {
        cfg.onError?.(error);
      } catch {}
      send(
        response,
        status,
        {
          400: "Bad request",
          413: "Request body too large",
          502: "Bad gateway",
          504: "Gateway timeout",
        }[status] || "Internal server error",
        cfg.headers,
        request.method,
      );
    }
  };
  handler.setStartpage = (filename) => {
    if (typeof filename !== "string" || !filename)
      throw new Error("Start page must be a nonempty filename");
    cfg.startpage = filename;
  };
  handler.setReady = (value) => {
    ready = Boolean(value);
  };
  return handler;
}
export async function serve(config = {}, BUILD_PROCESS) {
  if (BUILD_PROCESS?.ready) await BUILD_PROCESS.ready;
  const cfg = { ...defaultServer, ...config };
  validateServerTools(cfg);
  if (!Number.isInteger(cfg.port) || cfg.port < 0 || cfg.port > 65535)
    throw new Error("Server port must be an integer between 0 and 65535");
  if (typeof cfg.host !== "string" || !cfg.host)
    throw new Error("Server host must be a nonempty string");
  if (
    cfg.socket_protocol !== undefined &&
    !["ws", "wss"].includes(cfg.socket_protocol)
  )
    throw new Error("socket_protocol must be ws or wss");
  if (
    cfg.python_node !== undefined &&
    (!Number.isInteger(cfg.python_node) ||
      cfg.python_node < 0 ||
      cfg.python_node > 65535)
  )
    throw new Error("python_node must be a port from 0 to 65535");
  if (!Number.isFinite(cfg.shutdownTimeout) || cfg.shutdownTimeout < 0)
    throw new Error("shutdownTimeout must be nonnegative");
  for (const definition of Object.values(cfg.proxy || {})) {
    const target = new URL(
      typeof definition === "string" ? definition : definition.target,
    );
    if (!["http:", "https:"].includes(target.protocol))
      throw new Error("Proxy target must be HTTP or HTTPS");
  }
  if (cfg.production) cfg.hotreload = false;
  const sockets = {};
  const proxyConnections = new Set();
  if (cfg.hotreload) sockets.hotreload = new HotReload(cfg);
  let options;
  try {
    if (cfg.protocol === "https")
      options = {
        key: await fs.readFile(
          path.resolve(cfg.cwd || process.cwd(), cfg.keypath),
        ),
        cert: await fs.readFile(
          path.resolve(cfg.cwd || process.cwd(), cfg.certpath),
        ),
        passphrase: cfg.passphrase,
      };
    else if (cfg.protocol !== "http")
      throw new Error("Unsupported server protocol: " + cfg.protocol);
    const handler = createRequestHandler(cfg, sockets);
    const server = options
      ? https.createServer(options, handler)
      : http.createServer(handler);
    cfg.setStartpage = (filename) => {
      handler.setStartpage(filename);
      cfg.startpage = filename;
    };
    cfg.setReady = handler.setReady;
    server.requestTimeout = cfg.requestTimeout;
    server.headersTimeout = Math.min(cfg.requestTimeout, 60000);
    if (cfg.python) {
      sockets.python = new PythonRelay({ ...cfg, tls: options });
      await sockets.python.ready;
      if (cfg.python_node !== undefined) cfg.python_node = sockets.python.port;
      sockets.py_client = new PythonClient(cfg, sockets.python);
    }
    server.on("upgrade", (request, socket, head) => {
      if (
        cfg.allowedOrigins &&
        !cfg.allowedOrigins.includes(request.headers.origin)
      ) {
        socket.destroy();
        return;
      }
      const pathname = new URL(request.url, "http://localhost").pathname;
      const prefix = Object.keys(cfg.proxy || {})
        .sort((a, b) => b.length - a.length)
        .find(
          (prefix) =>
            cfg.proxy[prefix]?.ws &&
            (pathname === prefix ||
              pathname.startsWith(prefix.replace(/\/$/, "") + "/")),
        );
      if (prefix) {
        proxyWebSocket(
          request,
          socket,
          head,
          prefix,
          cfg.proxy[prefix],
          proxyConnections,
        );
        return;
      }
      const target =
        pathname === "/hotreload"
          ? sockets.hotreload
          : pathname === "/" || pathname === "/home"
            ? sockets.python
            : undefined;
      if (
        !target ||
        (cfg.allowedOrigins &&
          !cfg.allowedOrigins.includes(request.headers.origin))
      ) {
        socket.destroy();
        return;
      }
      target.wss.handleUpgrade(request, socket, head, (ws) =>
        target.wss.emit("connection", ws, request),
      );
    });
    const requestedPort = cfg.port;
    const retries = cfg.production || cfg.port === 0 ? 0 : cfg.portRetries;
    for (let attempt = 0; ; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          const cleanup = () => {
            server.removeListener("error", failed);
            server.removeListener("listening", listening);
          };
          const failed = (error) => {
            cleanup();
            reject(error);
          };
          const listening = () => {
            cleanup();
            resolve();
          };
          server.once("error", failed);
          server.once("listening", listening);
          server.listen(cfg.port, cfg.host);
        });
        break;
      } catch (error) {
        if (
          error.code === "EADDRINUSE" &&
          attempt < retries &&
          cfg.port < 65535
        ) {
          cfg.port++;
          continue;
        }
        if (error.code === "EADDRINUSE")
          error.message =
            "EADDRINUSE: Port " +
            cfg.port +
            " is already in use on " +
            cfg.host +
            ". " +
            (cfg.production
              ? "Choose an unused production port."
              : "Choose --port 0 for a free port, or enable server.portRetries.");
        throw error;
      }
    }
    cfg.requestedPort = requestedPort;
    server.on("error", (error) => {
      try {
        cfg.onError?.(error);
      } catch {}
    });
    cfg.SERVER = server;
    cfg.SOCKETS = sockets;
    cfg.port = server.address().port;
    cfg.url =
      cfg.protocol +
      "://" +
      (["0.0.0.0", "::"].includes(cfg.host)
        ? "localhost"
        : cfg.host.includes(":")
          ? "[" + cfg.host + "]"
          : cfg.host) +
      ":" +
      cfg.port;
    let closing;
    cfg.close = () =>
      (closing ||= (async () => {
        handler.setReady(false);
        const drained = new Promise((resolve) => server.close(resolve));
        server.closeIdleConnections?.();
        const timer = setTimeout(
          () => server.closeAllConnections?.(),
          cfg.shutdownTimeout,
        );
        timer.unref();
        try {
          for (const socket of proxyConnections) socket.destroy();
          await Promise.all(
            Object.values(sockets).map((socket) => socket.close()),
          );
          await drained;
        } finally {
          clearTimeout(timer);
        }
      })());
    return cfg;
  } catch (error) {
    await Promise.all(Object.values(sockets).map((socket) => socket.close()));
    throw error;
  }
}
import { outputContext } from "../reporting.js";
