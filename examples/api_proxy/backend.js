import { createServer } from "node:http";
createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      message: "Hello from the proxied backend",
      path: req.url,
    }),
  );
}).listen(8090, "127.0.0.1", () => console.log("Backend on 127.0.0.1:8090"));
