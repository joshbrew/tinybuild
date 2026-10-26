import fs from "node:fs";
fs.mkdirSync("generated", { recursive: true });
fs.writeFileSync(
  "generated/message.json",
  JSON.stringify({ message: "Prepared task → ready backend → frontend" }),
);
