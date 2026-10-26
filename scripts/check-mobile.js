import { checkMobileLifecycle } from "../tinybuild/mobile-smoke.js";
const args = process.argv.slice(2);
const value = (key) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
console.log(
  JSON.stringify(
    await checkMobileLifecycle({
      platform: value("--platform"),
      id: value("--id"),
      artifact: value("--artifact"),
      device: value("--device"),
      activity: value("--activity"),
      permissions: value("--permissions")?.split(","),
      relaunches:
        value("--relaunches") === undefined
          ? undefined
          : Number(value("--relaunches")),
      backgrounds:
        value("--backgrounds") === undefined
          ? undefined
          : Number(value("--backgrounds")),
      backgroundDelay:
        value("--backgroundDelay") === undefined
          ? undefined
          : Number(value("--backgroundDelay")),
      reconnectPort:
        value("--reconnectPort") === undefined
          ? undefined
          : Number(value("--reconnectPort")),
      dryRun: args.includes("--dryRun"),
    }),
    null,
    2,
  ),
);
