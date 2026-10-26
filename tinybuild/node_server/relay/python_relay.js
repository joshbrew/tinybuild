import WebSocket, { WebSocketServer } from "ws";
import http from "node:http";
import https from "node:https";
export class PythonRelay {
  constructor(config = {}) {
    this.config = config;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: config.maxPayload || 1024 * 1024,
    });
    this.wss.on("connection", (socket) => socket.on("error", () => {}));
    this.ready = Promise.resolve();
    if (config.python_node !== undefined) {
      this.server = config.tls
        ? https.createServer(config.tls)
        : http.createServer();
      this.server.on("request", (req, res) => {
        res.writeHead(404);
        res.end("WebSocket endpoint");
      });
      this.server.on("upgrade", (request, socket, head) => {
        if (
          (config.allowedOrigins &&
            !config.allowedOrigins.includes(request.headers.origin)) ||
          !["/", "/home"].includes(
            new URL(request.url, "http://localhost").pathname,
          )
        ) {
          socket.destroy();
          return;
        }
        this.wss.handleUpgrade(request, socket, head, (ws) =>
          this.wss.emit("connection", ws, request),
        );
      });
      this.ready = new Promise((resolve, reject) => {
        this.server.once("error", reject);
        this.server.listen(
          config.python_node,
          config.host || "localhost",
          () => {
            this.server.removeListener("error", reject);
            this.server.on("error", (error) => config.onError?.(error));
            this.port = this.server.address().port;
            resolve();
          },
        );
      });
      this.ready.catch(() => {});
    }
  }
  broadcast(message) {
    for (const socket of this.wss.clients)
      if (socket.readyState === WebSocket.OPEN)
        socket.send(message, { binary: false });
  }
  async close() {
    for (const socket of this.wss.clients) socket.terminate();
    await new Promise((resolve) => this.wss.close(resolve));
    await this.ready.catch(() => {});
    if (this.server?.listening)
      await new Promise((resolve) => this.server.close(resolve));
  }
}
export class PythonClient {
  constructor(config = {}, relay) {
    this.config = config;
    this.relay = relay;
    this.closed = false;
    this.attempt = 0;
    if (config.python) this.connect();
  }
  connect() {
    const config = this.config;
    this.url =
      config.pythonUrl ||
      (config.protocol === "https" ? "wss://" : "ws://") +
        config.host +
        ":" +
        config.python;
    this.ws = new WebSocket(this.url, {
      rejectUnauthorized: config.pythonRejectUnauthorized !== false,
    });
    this.ws.on("open", () => {
      this.attempt = 0;
      this.ws.send("nodejs");
    });
    this.ws.on("message", (message) => this.relay.broadcast(message));
    this.ws.on("error", (error) => config.onError?.(error));
    this.ws.on("close", () => {
      if (!this.closed) {
        this.timer = setTimeout(
          () => this.connect(),
          Math.min(100 * 2 ** this.attempt++, 3000),
        );
        this.timer.unref();
      }
    });
  }
  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.terminate();
  }
}
