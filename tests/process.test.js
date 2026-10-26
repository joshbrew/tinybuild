import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../tinybuild/process.js";
import { fixture, until, delay } from "./helpers.js";

test("cancelling a command also stops its owned descendant process", async (t) => {
  const abort = new AbortController();
  t.after(() => abort.abort());
  const root = await fixture(t);
  const descendant =
    'let n=0;setInterval(()=>require("fs").writeFileSync("heartbeat.txt",String(++n)),25);';
  const source =
    'const child=require("child_process").spawn(process.execPath,["-e",' +
    JSON.stringify(descendant) +
    '],{stdio:"ignore"});require("fs").writeFileSync("child.txt",String(child.pid));setInterval(()=>{},1000);';
  const running = runCommand(process.execPath, ["-e", source], {
    cwd: root,
    stdio: "ignore",
    signal: abort.signal,
  });
  running.catch(() => {});
  await until(() =>
    fs.readFile(path.join(root, "heartbeat.txt"), "utf8").then(
      (text) => Number(text) >= 2,
      () => false,
    ),
  );
  abort.abort();
  await assert.rejects(running, /Command aborted/);
  const last = await fs.readFile(path.join(root, "heartbeat.txt"), "utf8");
  await delay(150);
  assert.equal(
    await fs.readFile(path.join(root, "heartbeat.txt"), "utf8"),
    last,
  );
});
