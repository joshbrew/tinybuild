// App-level lifecycle hooks for opt-in script replacement. No Node imports.
export function createHotContext(
  id = "app",
  source = globalThis.document?.currentScript?.src,
) {
  const registry = (globalThis.__tinybuild_hot__ ||= new Map());
  const url = source ? new URL(source, globalThis.location?.href) : undefined;
  const owner = url ? url.origin + url.pathname : undefined;
  const key = (owner || "") + "\0" + id;
  let context = registry.get(key);
  if (!context) {
    context = { owner, data: {}, disposers: [], accepters: [] };
    registry.set(key, context);
  }
  return {
    data: context.data,
    dispose(callback) {
      context.disposers.push(callback);
      return () => {
        context.disposers = context.disposers.filter(
          (item) => item !== callback,
        );
      };
    },
    accept(callback = () => {}) {
      context.accepters.push(callback);
      return () => {
        context.accepters = context.accepters.filter(
          (item) => item !== callback,
        );
      };
    },
    invalidate() {
      globalThis.location?.reload();
    },
  };
}
