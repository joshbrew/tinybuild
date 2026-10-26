import { WebSocketServer, WebSocket } from "ws";

export class HotReload {
  constructor(cfg = {}) {
    this.config = cfg;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.lastError = null;
    this.events = new Set();
    this.heartbeat = setInterval(() => {
      for (const response of this.events)
        if (!response.write(": heartbeat\n\n")) response.destroy();
    }, 15000);
    this.heartbeat.unref();
    this.wss.on("connection", (socket) => {
      socket.on("error", () => {});
      if (this.lastError) socket.send(JSON.stringify(this.lastError));
    });
  }
  broadcast(message) {
    if (message.type === "error") this.lastError = message;
    else if (message.type === "built") this.lastError = null;
    const text = JSON.stringify(message);
    for (const response of this.events)
      if (!response.write("data: " + text + "\n\n")) response.destroy();
    for (const socket of this.wss.clients)
      if (socket.readyState === WebSocket.OPEN) socket.send(text);
  }
  close() {
    clearInterval(this.heartbeat);
    for (const response of this.events) response.end();
    this.events.clear();
    for (const socket of this.wss.clients) socket.terminate();
    return new Promise((resolve) => this.wss.close(resolve));
  }
  add(content) {
    return addHotReloadClient(
      content,
      "/hotreload",
      this.config.hotreloadTransport,
      this.config.socket_protocol,
    );
  }
  handleEvents(request, response) {
    if (request.method !== "GET") {
      response.writeHead(405);
      response.end();
      return;
    }
    if (
      this.config.allowedOrigins &&
      !this.config.allowedOrigins.includes(request.headers.origin)
    ) {
      response.writeHead(403);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    response.write(": connected\n\n");
    this.events.add(response);
    response.once("close", () => this.events.delete(response));
    if (this.lastError)
      response.write("data: " + JSON.stringify(this.lastError) + "\n\n");
  }
}
export function addHotReloadClient(
  content,
  socketUrl = "/hotreload",
  transport = "ws",
  socketProtocol,
) {
  const argument = JSON.stringify(socketUrl).replace(/</g, "\\u003c");
  return (
    content.toString() +
    "\n<script>(" +
    HotReloadClient.toString() +
    ")(" +
    argument +
    "," +
    JSON.stringify(transport).replace(/</g, "\\u003c") +
    "," +
    JSON.stringify(socketProtocol || null).replace(/</g, "\\u003c") +
    ")</script>"
  );
}
export function HotReloadClient(
  socketUrl = "/hotreload",
  transport = "ws",
  socketProtocol,
) {
  let attempt = 0,
    stopped = false,
    retry,
    socket;
  let replacing = Promise.resolve();
  let connectedOnce = false;
  const overlayId = "__tinybuild_error";
  function overlay(message) {
    let element = document.getElementById(overlayId);
    if (!message) {
      element?.remove();
      return;
    }
    if (!element) {
      element = document.createElement("pre");
      element.id = overlayId;
      Object.assign(element.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        padding: "24px",
        margin: "0",
        color: "#fff",
        background: "#321",
        overflow: "auto",
        whiteSpace: "pre-wrap",
      });
      document.body.append(element);
    }
    element.textContent = message;
  }
  function updateCSS(filename) {
    const target = new URL(filename, location.href);
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      if (new URL(link.href).pathname !== target.pathname) continue;
      const next = link.cloneNode();
      const url = new URL(link.href);
      url.searchParams.set("__tinybuild", String(Date.now()));
      next.href = url.href;
      next.onload = () => link.remove();
      next.onerror = () => next.remove();
      link.after(next);
    }
  }
  function connect() {
    const url = new URL(socketUrl, location.href);
    if (transport === "sse") {
      url.pathname = url.pathname.replace(/\/$/, "") + "/events";
      socket = new EventSource(url.href);
    } else {
      url.protocol = socketProtocol
        ? socketProtocol + ":"
        : location.protocol === "https:"
          ? "wss:"
          : "ws:";
      socket = new WebSocket(url.href);
    }
    socket.addEventListener("open", () => {
      attempt = 0;
      if (connectedOnce && !stopped) location.reload();
      connectedOnce = true;
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "error") {
        overlay(message.message);
        return;
      }
      if (message.type !== "built") return;
      overlay(null);
      const files = (message.files || []).filter(
        (file) => !/\.map(?:\?|$)/.test(file),
      );
      if (!files.length) return;
      if (files.every((file) => /\.css(?:\?|$)/.test(file))) {
        files.forEach(updateCSS);
        return;
      }
      if (
        message.reloadscripts &&
        files.every((file) => /\.js(?:\?|$)/.test(file))
      ) {
        replacing = replacing
          .then(async () => {
            const scripts = [
              ...document.querySelectorAll("script[src]"),
            ].filter((script) =>
              files.some(
                (file) =>
                  new URL(file, location.href).pathname ===
                  new URL(script.src).pathname,
              ),
            );
            // A changed lazy chunk needs a navigation to invalidate its module cache.
            if (
              !scripts.length ||
              !files.every((file) =>
                scripts.some(
                  (script) =>
                    new URL(file, location.href).pathname ===
                    new URL(script.src).pathname,
                ),
              )
            ) {
              location.reload();
              return;
            }
            const owners = new Set(
              scripts.map((script) => {
                const url = new URL(script.src);
                return url.origin + url.pathname;
              }),
            );
            const contexts = () =>
              [...(globalThis.__tinybuild_hot__?.values() || [])].filter(
                (context) => !context.owner || owners.has(context.owner),
              );
            for (const context of contexts()) {
              for (const dispose of context.disposers)
                await dispose(context.data, message);
              context.disposers = [];
              context.accepters = [];
            }
            for (const script of scripts) {
              if (
                !files.some(
                  (file) =>
                    new URL(file, location.href).pathname ===
                    new URL(script.src).pathname,
                )
              )
                continue;
              const next = document.createElement("script");
              for (const attribute of script.attributes)
                next.setAttribute(attribute.name, attribute.value);
              const url = new URL(script.src);
              url.searchParams.set("__tinybuild", String(Date.now()));
              next.src = url.href;
              const loaded = new Promise((resolve, reject) => {
                next.onload = resolve;
                next.onerror = () =>
                  reject(new Error("Script reload failed: " + url.pathname));
              });
              script.replaceWith(next);
              await loaded;
            }
            for (const context of contexts())
              for (const accept of context.accepters)
                await accept(context.data, message);
          })
          .catch((error) => overlay(error.message));
      } else location.reload();
    });
    socket.addEventListener("error", () => {});
    socket.addEventListener("close", () => {
      if (!stopped)
        retry = setTimeout(connect, Math.min(100 * 2 ** attempt++, 3000));
    });
  }
  addEventListener(
    "beforeunload",
    () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    },
    { once: true },
  );
  connect();
}
