import path from "node:path";
import { createBuildContexts } from "../bundler.js";
const builds = new Map();
function key(config) {
  return path.resolve(
    config.absWorkingDir || process.cwd(),
    config.outfile || config.outdir || "dist/index",
  );
}
export async function hotBundle(config = {}, changed = "") {
  const id = key(config);
  let state = builds.get(id);
  if (!state) {
    state = {
      context: createBuildContexts(config),
      pending: Promise.resolve(),
    };
    builds.set(id, state);
  }
  // Serialize calls while retaining each requested change. No separate CSS graph.
  const task = state.pending.then(async () => ({
    skipped: false,
    changed,
    bundles: await (await state.context).rebuild(),
  }));
  state.pending = task.catch(() => {});
  return task;
}
export const hotBundleImmediate = hotBundle;
export async function disposeHotBundles() {
  const states = [...builds.values()];
  builds.clear();
  for (const state of states) {
    await state.pending;
    await (await state.context).dispose();
  }
}
