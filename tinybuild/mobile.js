import { developmentURLs } from "./devices.js";

export function mobileDevelopment(config) {
  const actions = Object.values(config.mobile || {}).filter(
    (value) => value && typeof value === "object" && value.liveReload,
  );
  if (!actions.length) return config;
  if (config.build || config.production || config.server?.production)
    throw new Error(
      "mobile.liveReload requires development mode; remove build/production or use mobile=<platform> without build",
    );
  if (config.server === false)
    throw new Error("mobile.liveReload needs server enabled for web updates");
  for (const value of actions) {
    if (value.action !== "run")
      throw new Error("mobile.liveReload requires action:'run'");
    if (
      value.connection &&
      !["usb", "lan", "emulator", "simulator"].includes(value.connection)
    )
      throw new Error(
        "Mobile connection must be usb, lan, emulator or simulator",
      );
  }
  const lan = actions.some((value) => value.connection === "lan");
  return {
    ...config,
    server: {
      ...config.server,
      ...(lan &&
      (!config.server?.host ||
        ["localhost", "127.0.0.1", "::1"].includes(config.server.host))
        ? { host: "0.0.0.0" }
        : {}),
      hotreload:
        config.server?.hotreload === false
          ? true
          : (config.server?.hotreload ?? true),
    },
  };
}

export function mobileRunOptions(platform, settings, serverURL) {
  if (!settings.liveReload) return [];
  if (!serverURL)
    throw new Error(
      "A listening tinybuild server is required for mobile live reload",
    );
  const url = new URL(serverURL);
  const connection =
    settings.connection || (platform === "android" ? "usb" : "simulator");
  if (platform === "ios" && ["usb", "emulator"].includes(connection))
    throw new Error("iOS live reload uses connection:'simulator' or 'lan'");
  if (platform === "android" && connection === "simulator")
    throw new Error("Android uses connection:'emulator', 'usb' or 'lan'");
  let host = connection === "emulator" ? "10.0.2.2" : "localhost";
  if (connection === "lan") {
    const address = developmentURLs(serverURL, { host: settings.host })[0];
    if (!address)
      throw new Error(
        "No LAN address found; set mobile.<platform>.host to your computer's reachable address",
      );
    host = new URL(address).hostname;
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return [
    "--live-reload",
    "--host",
    host,
    "--port",
    port,
    ...(url.protocol === "https:" ? ["--https"] : []),
    ...(platform === "android" && connection === "usb"
      ? ["--forwardPorts", port + ":" + port]
      : []),
  ];
}
