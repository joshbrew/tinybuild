import { runTinybuild } from "./cli.js";
await runTinybuild(["init", ...process.argv.slice(2)]);
