// Import this from index.js after installing the native plugin packages.
import { Filesystem } from "@capacitor/filesystem";
import { Camera } from "@capacitor/camera";
import { LocalNotifications } from "@capacitor/local-notifications";
globalThis.demoNativeAdapters = { Filesystem, Camera, LocalNotifications };
