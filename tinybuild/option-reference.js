import fs from "node:fs";
import { defaultBundler } from "./esbuild/bundler.js";
import { defaultServer } from "./node_server/server.js";

// The annotated template owns the explanations. Optional values are examples,
// not defaults; actual defaults come from the runtime objects.
export function optionReference(search = "") {
  let types = {};
  try {
    types = JSON.parse(
      fs.readFileSync(new URL("./option-types.json", import.meta.url), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const lines = fs
    .readFileSync(
      new URL("./templates/tinybuild.config.js", import.meta.url),
      "utf8",
    )
    .split(/\r?\n/);
  const options = [];
  let group = "",
    comments = [];
  for (const original of lines) {
    const line = original.replace(/^(\s*)\/\/ ?/, "$1");
    const candidate = /^(\s*)([a-z_$][\w$]*):\s*(.*)/.exec(line);
    const setting =
      candidate && /[,\[{]\s*$/.test(candidate[3]) ? candidate : undefined;
    if (setting) {
      const indent = setting[1].length;
      if (indent === 2) group = setting[2];
      const direct =
        indent === 2 ||
        (indent === 4 && !["tasks", "remotes", "metadata"].includes(group)) ||
        (indent === 6 && group === "tasks");
      if (direct) {
        const key = indent === 2 ? setting[2] : group + "." + setting[2];
        const defaults =
          group === "server"
            ? defaultServer
            : group === "bundler"
              ? defaultBundler
              : {};
        const item = {
          path: key,
          ...(types[key] ? { type: types[key] } : {}),
          description: comments.join(" "),
          example: setting[3].replace(/,$/, ""),
        };
        if (
          indent === 4 &&
          Object.hasOwn(defaults, setting[2]) &&
          ["string", "number", "boolean"].includes(typeof defaults[setting[2]])
        )
          item.default = defaults[setting[2]];
        if (!options.some((value) => value.path === key)) options.push(item);
      }
      comments = [];
    } else if (/^\s*\/\//.test(original)) {
      const text = line.trim().replace(/^\/\/ ?/, "");
      if (text && !/^[}\]),]/.test(text)) comments.push(text);
      else comments = [];
    } else comments = [];
  }
  const terms = String(search).toLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((item) =>
    terms.every((term) =>
      (item.path + " " + item.description).toLowerCase().includes(term),
    ),
  );
}
