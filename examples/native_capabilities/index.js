import { createNativeBridge } from "tinybuild/client/native";
const bridge = createNativeBridge({
  web: {
    saveNote: async (text) => {
      sessionStorage.setItem("demo-note", text);
      return "Browser demo note saved";
    },
  },
  native: {
    saveNote: async (text) => {
      const Filesystem = globalThis.demoNativeAdapters?.Filesystem;
      if (!Filesystem)
        throw new Error(
          "Install plugins and inject the native adapter described in README.md",
        );
      await Filesystem.writeFile({
        path: "note.txt",
        data: text,
        directory: "DATA",
        encoding: "utf8",
      });
      return "Native note saved";
    },
  },
});
const output = document.querySelector("output");
output.textContent = "Capability demo ready";
const button = document.createElement("button");
button.textContent = "Save a demo note";
document.querySelector("main").append(button);
button.onclick = async () => {
  try {
    output.textContent = await bridge.call("saveNote", "Hello from tinybuild");
  } catch (error) {
    output.textContent = error.message;
  }
};
