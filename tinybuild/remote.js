import { startTasks } from "./tasks.js";
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";

export function remotePlan(config = {}) {
  const {
    host,
    directory,
    platform = "posix",
    command = ["npm", "start"],
    forwards = [],
    port = 22,
    identityFile,
    ready,
  } = config;
  if (
    typeof host !== "string" ||
    !/^(?:[\w.-]+@)?[a-z0-9][a-z0-9_.-]*$/i.test(host)
  )
    throw new Error("Remote host must be an SSH host alias or user@hostname");
  if (!["posix", "windows"].includes(platform))
    throw new Error("Remote platform must be posix or windows");
  if (
    directory !== undefined &&
    (typeof directory !== "string" || !directory || /[\r\n\0]/.test(directory))
  )
    throw new Error("Remote directory must be a path");
  if (
    command !== false &&
    (!Array.isArray(command) ||
      !command.length ||
      command.some(
        (value) =>
          typeof value !== "string" || !value || /[\r\n\0]/.test(value),
      ))
  )
    throw new Error(
      "Remote command must be a nonempty string array, or false for forwarding only",
    );
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Remote SSH port must be 1 to 65535");
  if (
    identityFile !== undefined &&
    (typeof identityFile !== "string" ||
      !identityFile ||
      /[\r\n\0]/.test(identityFile))
  )
    throw new Error("Remote identityFile must be a path");
  if (!Array.isArray(forwards))
    throw new Error("Remote forwards must be an array");
  const used = new Set();
  for (const forward of forwards) {
    if (
      !forward ||
      [forward.local, forward.remote].some(
        (value) => !Number.isInteger(value) || value < 1 || value > 65535,
      )
    )
      throw new Error("Forward ports must be 1 to 65535");
    if (used.has(forward.local))
      throw new Error("Duplicate local forwarded port");
    used.add(forward.local);
  }
  if (
    ready &&
    (typeof ready !== "object" ||
      typeof ready.url !== "string" ||
      !/^https?:\/\//.test(ready.url) ||
      (ready.timeout !== undefined &&
        (!Number.isFinite(ready.timeout) || ready.timeout <= 0)))
  )
    throw new Error(
      "Remote readiness needs an HTTP(S) URL and a positive timeout",
    );
  if (
    ready &&
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(ready.url).hostname)
  )
    throw new Error("Remote readiness must check a local forwarded URL");
  const args = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-p",
    String(port),
    ...(identityFile ? ["-i", identityFile] : []),
  ];
  for (const forward of forwards)
    args.push(
      "-L",
      "127.0.0.1:" + forward.local + ":127.0.0.1:" + forward.remote,
    );
  if (!command) args.push("-N");
  args.push(host);
  if (command) {
    if (platform === "windows") {
      const script =
        "$ErrorActionPreference = 'Stop'; " +
        (directory
          ? "Set-Location -LiteralPath " + psQuote(directory) + "; "
          : "") +
        "& " +
        command.map(psQuote).join(" ") +
        "; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }";
      args.push(
        "powershell.exe -NoProfile -NonInteractive -EncodedCommand " +
          Buffer.from(script, "utf16le").toString("base64"),
      );
    } else
      args.push(
        (directory ? "cd -- " + quote(directory) + " && " : "") +
          "exec " +
          command.map(quote).join(" "),
      );
  }
  return {
    command: "ssh",
    args,
    ready,
    urls: forwards.map((forward) => "http://127.0.0.1:" + forward.local),
    note: "Runs on an existing SSH host. Source synchronization and SDK installation stay under your control.",
  };
}

export async function startRemote(
  config,
  {
    dryRun = false,
    signal,
    supervise = startTasks,
    onError = () => {},
    ...options
  } = {},
) {
  const plan = remotePlan(config);
  if (dryRun) return { ...plan, dryRun: true };
  let workspace;
  workspace = await supervise(
    { remote: { command: plan.command, args: plan.args, ready: plan.ready } },
    {
      ...options,
      signal,
      onError(error) {
        onError(error);
        workspace?.close().catch(onError);
      },
    },
  );
  return { ...plan, tasks: workspace, close: () => workspace.close() };
}
