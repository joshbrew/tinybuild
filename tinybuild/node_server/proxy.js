import http from "node:http";
import https from "node:https";
import { pipeline } from "node:stream/promises";
const hopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
function headers(values) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key]) => !hopHeaders.has(key.toLowerCase()),
    ),
  );
}
export async function proxyRequest(
  request,
  response,
  incoming,
  prefix,
  definition,
  globalHeaders = {},
) {
  const options =
    typeof definition === "string" ? { target: definition } : definition;
  const target = new URL(options.target);
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("Proxy target must be HTTP or HTTPS");
  const suffix = options.stripPrefix
    ? incoming.pathname.slice(prefix.length) || "/"
    : incoming.pathname;
  target.pathname =
    target.pathname.replace(/\/$/, "") + "/" + suffix.replace(/^\//, "");
  target.search = incoming.search;
  const maximum = options.maxBodyBytes ?? 1024 * 1024;
  if (Number(request.headers["content-length"] || 0) > maximum) {
    response.writeHead(413);
    response.end("Request body too large");
    request.resume();
    return;
  }
  await new Promise((resolve, reject) => {
    const upstream = (target.protocol === "https:" ? https : http).request(
      target,
      {
        method: request.method,
        headers: {
          ...headers(request.headers),
          ...(options.changeOrigin === false ? {} : { host: target.host }),
          ...options.headers,
        },
      },
    );
    let size = 0;
    const abort = () => upstream.destroy();
    request.once("aborted", abort);
    response.once("close", () => {
      if (!response.writableEnded) abort();
    });
    upstream.setTimeout(options.timeout ?? 10000, () => {
      const error = new Error("Proxy timed out");
      error.status = 504;
      upstream.destroy(error);
    });
    upstream.once("error", (error) => {
      request.unpipe(upstream);
      request.resume();
      request.removeListener("aborted", abort);
      error.status ||= 502;
      reject(error);
    });
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maximum) {
        const error = new Error("Request body too large");
        error.status = 413;
        upstream.destroy(error);
      }
    });
    upstream.once("response", async (result) => {
      try {
        response.writeHead(result.statusCode, {
          ...headers(result.headers),
          ...globalHeaders,
        });
        await pipeline(result, response);
        request.removeListener("aborted", abort);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    request.pipe(upstream);
  });
}

// Forward the handshake and then pipe bytes unchanged, including binary frames.
export function proxyWebSocket(
  request,
  socket,
  head,
  prefix,
  definition,
  connections,
) {
  const options =
    typeof definition === "string" ? { target: definition } : definition;
  const target = new URL(options.target);
  const incoming = new URL(request.url, "http://localhost");
  const suffix = options.stripPrefix
    ? incoming.pathname.slice(prefix.length) || "/"
    : incoming.pathname;
  target.pathname =
    target.pathname.replace(/\/$/, "") + "/" + suffix.replace(/^\//, "");
  target.search = incoming.search;
  connections.add(socket);
  const upstream = (target.protocol === "https:" ? https : http).request(
    target,
    {
      headers: {
        ...request.headers,
        ...(options.changeOrigin === false ? {} : { host: target.host }),
        ...options.headers,
      },
    },
  );
  const timer = setTimeout(
    () => upstream.destroy(new Error("WebSocket proxy handshake timed out")),
    options.timeout ?? 10000,
  );
  timer.unref();
  const fail = () => {
    clearTimeout(timer);
    if (!socket.destroyed)
      socket.end(
        "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
  };
  socket.on("error", () => socket.destroy());
  socket.once("close", () => {
    clearTimeout(timer);
    connections.delete(socket);
    upstream.destroy();
  });
  upstream.once("error", fail);
  upstream.once("response", (response) => {
    response.destroy();
    fail();
  });
  upstream.once("upgrade", (response, peer, upstreamHead) => {
    clearTimeout(timer);
    connections.add(peer);
    peer.on("error", () => peer.destroy());
    peer.once("close", () => {
      connections.delete(peer);
      socket.destroy();
    });
    socket.once("close", () => peer.destroy());
    const lines = [];
    for (let i = 0; i < response.rawHeaders.length; i += 2)
      lines.push(response.rawHeaders[i] + ": " + response.rawHeaders[i + 1]);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" + lines.join("\r\n") + "\r\n\r\n",
    );
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) peer.write(head);
    socket.pipe(peer).pipe(socket);
  });
  upstream.end();
}
