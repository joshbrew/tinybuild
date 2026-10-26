// Presets only describe dependencies and declarations. Runtime permissions stay in the app.
export function nativePresets(presets = []) {
  const plugins = new Map();
  const android = new Set();
  const ios = {};
  for (const entry of presets) {
    const value = typeof entry === "string" ? { name: entry } : entry;
    switch (value.name) {
      case "camera":
        plugins.set("@capacitor/camera", {
          target: "mobile",
          name: "@capacitor/camera",
          version: "^8.0.0",
        });
        Object.assign(ios, {
          NSCameraUsageDescription:
            value.description || "Take a photo for this app.",
          NSPhotoLibraryUsageDescription:
            value.photosDescription || "Choose a photo for this app.",
          NSPhotoLibraryAddUsageDescription:
            value.saveDescription || "Save a photo from this app.",
        });
        break;
      case "files":
        plugins.set("@capacitor/filesystem", {
          target: "mobile",
          name: "@capacitor/filesystem",
          version: "^8.0.0",
        });
        break;
      case "notifications":
        plugins.set("@capacitor/local-notifications", {
          target: "mobile",
          name: "@capacitor/local-notifications",
          version: "^8.0.0",
        });
        android.add("android.permission.POST_NOTIFICATIONS");
        break;
      case "secureStorage":
        if (!value.plugin?.name)
          throw new Error(
            "secureStorage requires an explicit plugin provider; preferences and localStorage are not encrypted storage",
          );
        plugins.set(value.plugin.name, { ...value.plugin, target: "mobile" });
        break;
      default:
        throw new Error("Unknown native preset: " + value.name);
    }
  }
  return {
    plugins: [...plugins.values()],
    permissions: { android: [...android], ios },
  };
}
