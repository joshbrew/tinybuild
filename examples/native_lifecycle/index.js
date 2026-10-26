import { watchAppLifecycle } from "tinybuild/client/native";
import { createHotContext } from "tinybuild/client/hot";
document.body.innerHTML = `<main><h1>Native and browser lifecycle</h1>
<p>Switch apps, hide this page, or take the browser offline to see the state change.</p>
<output></output><p><button>Check camera permission</button></p><pre>Permission has not been checked</pre></main>`;
const output = document.querySelector("output");
const permissions = document.querySelector("pre");
const lifecycle = watchAppLifecycle({
  nativeApp: globalThis.demoAppAdapter,
  onChange: (state) => {
    output.textContent = `${state.active ? "Active" : "Background"} / ${state.online ? "Online" : "Offline"}`;
  },
  onError: (error) => {
    permissions.textContent = error.message;
  },
});
document.querySelector("button").onclick = async () => {
  try {
    const state = globalThis.demoCameraAdapter
      ? await globalThis.demoCameraAdapter.checkPermissions()
      : await navigator.permissions.query({ name: "camera" });
    permissions.textContent =
      "Camera permission: " + (state.camera || state.state);
  } catch {
    permissions.textContent =
      "Camera permission checking is unavailable on this browser";
  }
};
createHotContext("native-lifecycle").dispose(() => lifecycle.close());
