import { createServer } from "node:http";
createServer((req, res) => {
  res.setHeader("Content-Type", "text/javascript");
  res.end(
    'export const message="Fetched and cached from a local HTTP module";',
  );
}).listen(9099, "127.0.0.1", () =>
  console.log("Remote module fixture on http://127.0.0.1:9099"),
);
