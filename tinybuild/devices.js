import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

export function developmentURLs(
  url,
  { interfaces = os.networkInterfaces(), host } = {},
) {
  const parsed = new URL(url);
  const hosts = host
    ? [host]
    : [
        ...new Set(
          Object.values(interfaces)
            .flat()
            .filter(
              (item) =>
                item &&
                !item.internal &&
                (item.family === "IPv4" || item.family === 4),
            )
            .map((item) => item.address),
        ),
      ];
  return hosts.map((address) => {
    const value = new URL(parsed);
    value.hostname = address.includes(":")
      ? "[" + address.replace(/^\[|\]$/g, "") + "]"
      : address;
    return value.href;
  });
}

export async function discoverDevices({
  platform = process.platform,
  sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT,
  run = execute,
} = {}) {
  const result = { android: [], emulators: [], ios: [], errors: [] };
  async function read(command, args, consume) {
    try {
      const output = await run(command, args, {
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      consume(output.stdout);
    } catch (error) {
      result.errors.push({ command, message: error.message });
    }
  }
  const binary = (folder, name) =>
    sdk
      ? path.join(sdk, folder, name + (platform === "win32" ? ".exe" : ""))
      : name;
  await Promise.all([
    read(binary("platform-tools", "adb"), ["devices", "-l"], (output) => {
      for (const line of output.split(/\r?\n/).slice(1)) {
        const match = /^(\S+)\s+(device|offline|unauthorized)\b(.*)$/.exec(
          line,
        );
        if (match)
          result.android.push({
            id: match[1],
            status: match[2],
            model: /model:(\S+)/.exec(match[3])?.[1],
          });
      }
    }),
    read(binary("emulator", "emulator"), ["-list-avds"], (output) => {
      result.emulators = output.trim().split(/\r?\n/).filter(Boolean);
    }),
    ...(platform === "darwin"
      ? [
          read(
            "xcrun",
            ["simctl", "list", "devices", "available", "--json"],
            (output) => {
              result.ios = Object.entries(JSON.parse(output).devices).flatMap(
                ([runtime, devices]) =>
                  devices.map(({ name, udid, state }) => ({
                    id: udid,
                    name,
                    state,
                    runtime,
                  })),
              );
            },
          ),
        ]
      : []),
  ]);
  return result;
}

export async function developmentQR(url, options = {}) {
  for (const [key, value] of Object.entries(options))
    if (
      !["width", "margin"].includes(key) ||
      !Number.isFinite(value) ||
      value < 0 ||
      (key === "width" && value === 0)
    )
      throw new Error("Invalid QR option: " + key);
  const QRCode = (await import("qrcode-generator")).default;
  const qr = QRCode(0, "M");
  qr.addData(new URL(url).href);
  qr.make();
  const svg = qr.createSvgTag({
    cellSize: 4,
    margin: options.margin,
    scalable: true,
  });
  return options.width
    ? svg.replace(
        "<svg ",
        '<svg width="' + options.width + '" height="' + options.width + '" ',
      )
    : svg;
}
