import fs from "node:fs/promises";
import path from "node:path";
import { writeMissing } from "./create.js";
import { nativePresets } from "./native-presets.js";
const resolvedNative = Symbol("resolved native app");

export function nativeApp(options = {}) {
  const { profiles = {}, profile, ...base } = options;
  if (profile && !Object.hasOwn(profiles, profile))
    throw new Error("Unknown native profile: " + profile);
  const variant = profile ? profiles[profile] : {};
  const native = {
    ...base,
    ...variant,
    profile,
    targets: { ...base.targets, ...variant.targets },
    icons: { ...base.icons, ...variant.icons },
    env: { ...base.env, ...variant.env },
    permissions: { ...base.permissions, ...variant.permissions },
    plugins: [...(base.plugins || []), ...(variant.plugins || [])],
  };
  for (const name of ["electron", "tauri", "mobile"])
    if (
      base.targets?.[name] &&
      variant.targets?.[name] &&
      typeof base.targets[name] === "object" &&
      typeof variant.targets[name] === "object"
    )
      native.targets[name] = {
        ...base.targets[name],
        ...variant.targets[name],
      };
  const presets = nativePresets([
    ...(base.presets || []),
    ...(variant.presets || []),
  ]);
  native.plugins = [
    ...new Map(
      [...presets.plugins, ...native.plugins].map((plugin) => [
        plugin.name,
        plugin,
      ]),
    ).values(),
  ];
  native.permissions = {
    ...native.permissions,
    android: [
      ...new Set([
        ...presets.permissions.android,
        ...(native.permissions.android || []),
      ]),
    ],
    ios: { ...presets.permissions.ios, ...native.permissions.ios },
  };
  for (const plugin of native.plugins)
    if (
      !plugin ||
      typeof plugin.name !== "string" ||
      (plugin.target &&
        !["electron", "tauri", "mobile"].includes(plugin.target))
    )
      throw new Error("Native plugins require a name and supported target");
  if (native.id && !/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(native.id))
    throw new Error("Native id must be a reverse-domain identifier");
  if (native.version && !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(native.version))
    throw new Error("Native version must be a semantic version");
  if (
    native.buildNumber !== undefined &&
    (!Number.isInteger(native.buildNumber) || native.buildNumber < 1)
  )
    throw new Error("Native buildNumber must be a positive integer");
  const result = { native };
  Object.defineProperty(native, resolvedNative, { value: options });
  for (const target of ["electron", "tauri", "mobile"])
    if (Object.hasOwn(native.targets, target))
      result[target] = native.targets[target];
  return result;
}

export function resolveNativeConfig(config) {
  if (config.profile && config.native?.profile !== config.profile)
    return selectNativeProfile(config, config.profile);
  if (!config.native || config.native[resolvedNative]) return config;
  const expanded = nativeApp(config.native);
  return { ...expanded, ...config, native: expanded.native };
}
export function selectNativeProfile(config, profile) {
  if (!config.native)
    throw new Error("A native app definition is required to select a profile");
  const original = config.native[resolvedNative] || config.native;
  const expanded = nativeApp({ ...original, profile });
  const result = { ...config, ...expanded };
  if (Object.hasOwn(config, "profile")) result.profile = profile;
  // Explicit target overrides remain useful, but macro targets follow the new profile.
  for (const target of ["electron", "tauri", "mobile"])
    if (!Object.hasOwn(expanded, target)) delete result[target];
  return result;
}

const xml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
export async function applyNativePermissions(native, cwd) {
  const permissions = native.permissions || {};
  if (permissions.android?.length) {
    const filename = path.join(cwd, "android/app/src/main/AndroidManifest.xml");
    let source;
    try {
      source = await fs.readFile(filename, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") source = undefined;
      else throw error;
    }
    if (source !== undefined) {
      const additions = permissions.android.filter((name) => {
        if (!/^[A-Za-z][\w.]+$/.test(name))
          throw new Error("Invalid Android permission: " + name);
        return (
          !source.includes('android:name="' + name + '"') &&
          !source.includes("android:name='" + name + "'")
        );
      });
      if (additions.length) {
        if (!source.includes("</manifest>"))
          throw new Error("Invalid Android manifest");
        source = source.replace(
          "</manifest>",
          additions
            .map(
              (name) => '    <uses-permission android:name="' + name + '" />',
            )
            .join("\n") + "\n</manifest>",
        );
        await fs.writeFile(filename, source);
      }
    }
  }
  if (permissions.ios && Object.keys(permissions.ios).length) {
    const filename = path.join(cwd, "ios/App/App/Info.plist");
    let source;
    try {
      source = await fs.readFile(filename, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") source = undefined;
      else throw error;
    }
    if (source !== undefined) {
      const additions = Object.entries(permissions.ios).filter(
        ([key, value]) => {
          if (!/^NS\w+UsageDescription$/.test(key) || typeof value !== "string")
            throw new Error(
              "iOS permissions require NS…UsageDescription string values",
            );
          return !source.includes("<key>" + key + "</key>");
        },
      );
      const index = source.lastIndexOf("</dict>");
      if (index < 0) throw new Error("Invalid iOS Info.plist");
      if (additions.length)
        await fs.writeFile(
          filename,
          source.slice(0, index) +
            additions
              .map(
                ([key, value]) =>
                  "<key>" + key + "</key><string>" + xml(value) + "</string>\n",
              )
              .join("") +
            source.slice(index),
        );
    }
  }
}

export async function applyNativeMetadata(native, cwd) {
  async function update(relative, transform) {
    const file = path.join(cwd, relative);
    let source;
    try {
      source = await fs.readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const next = transform(source);
    if (next !== source) await fs.writeFile(file, next);
  }
  for (const file of [
    "android/app/build.gradle",
    "android/app/build.gradle.kts",
  ])
    await update(file, (source) => {
      if (native.version)
        source = source.replace(
          /(\bversionName\s*=?\s*)["'][^"']*["']/g,
          '$1"' + native.version + '"',
        );
      if (native.buildNumber)
        source = source.replace(
          /(\bversionCode\s*=?\s*)\d+/g,
          (_, start) => start + native.buildNumber,
        );
      return source;
    });
  if (native.name)
    await update("android/app/src/main/res/values/strings.xml", (source) =>
      source.replace(
        /(<string\s+name=["'](?:app_name|title_activity_main)["'][^>]*>)[\s\S]*?(<\/string>)/g,
        (_, start, end) => start + xml(native.name) + end,
      ),
    );
  await update("ios/App/App/Info.plist", (source) => {
    for (const [key, value] of Object.entries({
      CFBundleShortVersionString: native.version?.split(/[+-]/)[0],
      CFBundleVersion: native.buildNumber,
      CFBundleDisplayName: native.name,
    }))
      if (value !== undefined)
        source = source.replace(
          new RegExp(
            "(<key>" + key + "</key>\\s*<string>)[\\s\\S]*?(</string>)",
            "g",
          ),
          (_, start, end) => start + xml(value) + end,
        );
    return source;
  });
}

export async function prepareNativeConfig(config, cwd, { devUrl } = {}) {
  const native = config.native || {};
  if (!config.native && !config.tauri) return undefined;
  const directory = path.join(cwd, ".tinybuild");
  for (const filename of [
    ...(native.icons?.tauri || []),
    ...(native.icons?.electron ? [native.icons.electron] : []),
  ])
    await fs.access(path.resolve(cwd, filename));
  if (
    native.icons?.mobile &&
    !(await fs.stat(path.resolve(cwd, native.icons.mobile))).isDirectory()
  )
    throw new Error("Native mobile icons must name an asset directory");
  await fs.mkdir(directory, { recursive: true });
  const actions = [
    config.electron && (config.electron.action || "open"),
    config.tauri && (config.tauri.action || "build"),
    ...Object.values(config.mobile || {})
      .filter(Boolean)
      .map((value) =>
        typeof value === "object"
          ? value.action
          : value === true
            ? "run"
            : value,
      ),
  ].filter((value) => value && value !== "stage");
  const releaseOnly =
    config.production ||
    (actions.length &&
      actions.every((action) => ["build", "package", "make"].includes(action)));
  const url = releaseOnly
    ? undefined
    : native.devUrl === true
      ? devUrl
      : native.devUrl;
  if (!releaseOnly && native.devUrl === true && !url)
    throw new Error("native.devUrl:true needs a running development server");
  if (url && !/^https?:\/\//.test(url))
    throw new Error("Native development URL must use HTTP(S)");
  const capacitor = {
    appId: native.id || "com.tinybuild.app",
    appName: native.name || "Tinybuild App",
    webDir: "mobile_dist",
    ...(url ? { server: { url, cleartext: url.startsWith("http:") } } : {}),
    ...native.capacitor,
  };
  const capacitorFile = path.join(directory, "native-capacitor.json");
  await fs.writeFile(capacitorFile, JSON.stringify(capacitor, null, 2));
  // New projects consume the generated config. Existing user configs remain intact.
  if (
    config.mobile &&
    !(await exists(path.join(cwd, "capacitor.config.ts"))) &&
    !(await exists(path.join(cwd, "capacitor.config.js"))) &&
    !(await exists(path.join(cwd, "capacitor.config.json")))
  ) {
    writeMissing(
      path.join(cwd, "capacitor.config.ts"),
      'import fs from "node:fs";\nimport path from "node:path";\nexport default JSON.parse(fs.readFileSync(path.resolve(".tinybuild/native-capacitor.json"), "utf8"));\n',
    );
  }
  const manualConfig = [];
  if (config.mobile)
    for (const filename of [
      "capacitor.config.ts",
      "capacitor.config.js",
      "capacitor.config.json",
    ]) {
      const location = path.join(cwd, filename);
      if (await exists(location)) {
        if (
          !(await fs.readFile(location, "utf8")).includes(
            "native-capacitor.json",
          )
        )
          manualConfig.push(location);
        break;
      }
    }
  const tauriDev =
    config.tauri?.action === "dev" && config.tauri.liveReload !== false
      ? url || devUrl
      : undefined;
  if (config.tauri?.liveReload && !tauriDev)
    throw new Error("Tauri liveReload needs a listening development server");
  const origin = tauriDev && new URL(tauriDev).origin;
  const devCsp = tauriDev
    ? `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; connect-src 'self' ipc: http://ipc.localhost ${origin} ${origin.replace(/^http/, "ws")}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:`
    : undefined;
  const tauri = {
    ...(native.id ? { identifier: native.id } : {}),
    ...(native.name ? { productName: native.name } : {}),
    ...(native.version ? { version: native.version } : {}),
    ...native.tauri,
    build: {
      ...(tauriDev || url ? { devUrl: tauriDev || url } : {}),
      ...(config.tauri?.liveReload === false ? { devUrl: null } : {}),
      ...native.tauri?.build,
    },
    ...(native.icons?.tauri
      ? {
          bundle: {
            icon: native.icons.tauri.map((file) =>
              path
                .relative(path.join(cwd, "src-tauri"), path.resolve(cwd, file))
                .split(path.sep)
                .join("/"),
            ),
            ...native.tauri?.bundle,
          },
        }
      : {}),
    ...(devCsp
      ? {
          app: {
            ...native.tauri?.app,
            security: { devCsp, ...native.tauri?.app?.security },
          },
        }
      : {}),
  };
  const tauriFile = path.join(directory, "native-tauri.json");
  await fs.writeFile(tauriFile, JSON.stringify(tauri, null, 2));
  if (config.tauri && native.permissions?.tauri?.length) {
    const target = path.join(cwd, "src-tauri/capabilities/tinybuild.json");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      JSON.stringify(
        {
          identifier: "tinybuild",
          windows: ["*"],
          permissions: native.permissions.tauri,
        },
        null,
        2,
      ),
    );
  }
  return { directory, capacitorFile, tauriFile, devUrl: url, manualConfig };
}
async function exists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
