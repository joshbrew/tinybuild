import http from "node:http";
import { WebSocketServer } from "ws";
const server = http.createServer((req, res) => res.end("WebSocket backend"));
const sockets = new WebSocketServer({ server });
sockets.on("connection", (socket) =>
  socket.on("message", (value, isBinary) =>
    socket.send(value, { binary: isBinary }),
  ),
);
server.listen(7000, "127.0.0.1", () =>
  console.log("Backend: http://127.0.0.1:7000"),
);
