import http from "node:http";
import fs from "node:fs";
http
  .createServer((req, res) => {
    if (req.url === "/ready") res.end("ready");
    else {
      res.setHeader("Content-Type", "application/json");
      res.end(fs.readFileSync("generated/message.json"));
    }
  })
  .listen(Number(process.env.PORT || 8099), "127.0.0.1");
