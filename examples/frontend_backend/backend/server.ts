import { createServer } from "node:http";
const port = Number(process.env.PORT || 8081);
createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({ message: "Standalone Node backend", path: req.url }),
  );
}).listen(port, "127.0.0.1", () =>
  console.log("Backend on http://127.0.0.1:" + port),
);
