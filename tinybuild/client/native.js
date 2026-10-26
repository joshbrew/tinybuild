// Inject adapters with the same contract; no native runtime is loaded by this helper.
export function createNativeBridge({
  native = {},
  web = {},
  isNative = () => globalThis.Capacitor?.isNativePlatform?.() === true,
} = {}) {
  return {
    has(name) {
      const adapter = isNative() ? native : web;
      return (
        Object.hasOwn(adapter, name) && typeof adapter[name] === "function"
      );
    },
    async call(name, ...args) {
      const adapter = isNative() ? native : web;
      const implementation = adapter[name];
      if (typeof implementation !== "function" || !Object.hasOwn(adapter, name))
        throw new Error("Capability unavailable: " + name);
      return implementation(...args);
    },
  };
}

// Optional Capacitor App adapter; ordinary browsers need no native dependency.
export function watchAppLifecycle({
  onChange,
  nativeApp,
  window: page = globalThis.window,
  document: document = globalThis.document,
  navigator: network = globalThis.navigator,
  onError = () => {},
} = {}) {
  if (typeof onChange !== "function")
    throw new Error("Lifecycle onChange must be a function");
  let closed = false,
    handle,
    nativeActive;
  const publish = (reason) => {
    if (!closed)
      onChange({
        active: nativeActive ?? document?.visibilityState !== "hidden",
        online: network?.onLine !== false,
        reason,
      });
  };
  const visibility = () => publish("visibility");
  const connectivity = () => publish("network");
  document?.addEventListener("visibilitychange", visibility);
  page?.addEventListener("online", connectivity);
  page?.addEventListener("offline", connectivity);
  const listening = nativeApp
    ? Promise.resolve()
        .then(() =>
          nativeApp.addListener("appStateChange", (event) => {
            nativeActive = Boolean(event.isActive);
            publish("native");
          }),
        )
        .then(async (result) => {
          if (closed) await result.remove();
          else handle = result;
        })
        .catch((error) => {
          if (!closed) onError(error);
        })
    : Promise.resolve();
  publish("initial");
  let closing;
  return {
    close() {
      return (closing ||= (async () => {
        closed = true;
        document?.removeEventListener("visibilitychange", visibility);
        page?.removeEventListener("online", connectivity);
        page?.removeEventListener("offline", connectivity);
        await listening;
        await handle?.remove();
      })());
    },
  };
}
