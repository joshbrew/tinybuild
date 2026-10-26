const electronAction = (value) =>
  typeof value === "object" ? value.action || "open" : "open";
const tauriAction = (value) =>
  typeof value === "object" ? value.action || "build" : "build";
export function desktopDevelopment(config) {
  const enabled = Boolean(
    config.electron?.liveReload || config.tauri?.liveReload,
  );
  if (!enabled) return config;
  if (config.build || config.production || config.server?.production)
    throw new Error("Desktop liveReload requires development mode");
  if (config.server === false)
    throw new Error("Desktop liveReload needs an enabled server");
  if (config.electron?.liveReload && electronAction(config.electron) !== "open")
    throw new Error("Electron liveReload requires action:'open'");
  if (config.tauri?.liveReload && tauriAction(config.tauri) !== "dev")
    throw new Error("Tauri liveReload requires action:'dev'");
  return {
    ...config,
    server: {
      ...config.server,
      hotreload:
        config.server?.hotreload === false
          ? true
          : (config.server?.hotreload ?? true),
    },
  };
}
export function electronLaunchOptions(options = {}) {
  for (const name of ["devtools", "liveReload"])
    if (options[name] !== undefined && typeof options[name] !== "boolean")
      throw new Error("Electron " + name + " must be a boolean");
  if (
    options.watch !== undefined &&
    typeof options.watch !== "boolean" &&
    (!Array.isArray(options.watch) ||
      !options.watch.length ||
      options.watch.some((value) => typeof value !== "string" || !value))
  )
    throw new Error(
      "Electron watch must be true, false or a nonempty list of paths",
    );
  if (
    options.restartDelay !== undefined &&
    (!Number.isFinite(options.restartDelay) || options.restartDelay < 0)
  )
    throw new Error("Electron restartDelay must be a nonnegative number");
  if (options.watch && options.action && options.action !== "open")
    throw new Error("Electron watch requires action:'open'");
  const inspect = options.inspect === true ? 9229 : options.inspect;
  if (
    inspect !== undefined &&
    inspect !== false &&
    (!Number.isInteger(inspect) || inspect < 0 || inspect > 65535)
  )
    throw new Error("Electron inspect must be true or a port from 0 to 65535");
  if (
    options.args &&
    (!Array.isArray(options.args) ||
      options.args.some((value) => typeof value !== "string"))
  )
    throw new Error("Electron args must be a string array");
  const window = options.window || {};
  const allowed = [
    "width",
    "height",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "title",
    "backgroundColor",
    "resizable",
    "maximizable",
    "fullscreen",
  ];
  for (const [name, value] of Object.entries(window)) {
    if (!allowed.includes(name))
      throw new Error(
        "Unsupported Electron window option: " +
          name +
          "; edit a custom shell for advanced BrowserWindow settings",
      );
    if (
      /^(?:min|max)?(?:Width|Height)$|^(?:width|height)$/.test(name) &&
      (!Number.isInteger(value) || value < 1)
    )
      throw new Error(
        "Electron window " + name + " must be a positive integer",
      );
    if (
      ["title", "backgroundColor"].includes(name) &&
      typeof value !== "string"
    )
      throw new Error("Electron window " + name + " must be a string");
    if (
      ["resizable", "maximizable", "fullscreen"].includes(name) &&
      typeof value !== "boolean"
    )
      throw new Error("Electron window " + name + " must be a boolean");
  }
  return {
    flags:
      inspect === undefined || inspect === false
        ? []
        : ["--inspect=" + inspect],
    args: options.args || [],
    window,
    devtools: options.devtools === true,
  };
}
export function tauriCommand(options = {}, configFile) {
  const action = options.action === "dev" ? "dev" : "build";
  for (const name of ["watch", "debug", "noBundle", "liveReload"])
    if (options[name] !== undefined && typeof options[name] !== "boolean")
      throw new Error("Tauri " + name + " must be a boolean");
  if (
    options.bundles &&
    (!Array.isArray(options.bundles) ||
      options.bundles.some((value) => typeof value !== "string" || !value))
  )
    throw new Error("Tauri bundles must be a string array");
  if (options.noBundle && options.bundles)
    throw new Error("Choose Tauri bundles or noBundle");
  if (
    options.features &&
    (!Array.isArray(options.features) ||
      options.features.some((value) => typeof value !== "string" || !value))
  )
    throw new Error("Tauri features must be a string array");
  if (
    action === "dev" &&
    (options.noBundle || options.bundles || options.debug)
  )
    throw new Error(
      "Tauri bundles/noBundle/debug apply to build; dev already uses debug mode",
    );
  return [
    "tauri",
    action,
    ...(configFile ? ["--config", configFile] : []),
    ...(options.target ? ["--target", options.target] : []),
    ...(options.features?.length
      ? ["--features", options.features.join(",")]
      : []),
    ...(options.bundles ? ["--bundles", options.bundles.join(",")] : []),
    ...(action === "dev" && options.watch === false ? ["--no-watch"] : []),
    ...(action === "build" && options.debug ? ["--debug"] : []),
    ...(action === "build" && options.noBundle ? ["--no-bundle"] : []),
  ];
}
