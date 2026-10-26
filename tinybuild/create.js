import fs from "node:fs";
import path from "node:path";
import { getTemplateSync, copyFolderSync } from "./templates/get.js";

export function writeMissing(filename, content) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  try {
    fs.writeFileSync(filename, content, { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}
const template = (filename) => getTemplateSync(filename).toString();
const write = (filename, content, fallback) =>
  writeMissing(
    filename,
    typeof content === "function" ? content() : (content ?? template(fallback)),
  );
const create = {
  entry: (filename, content) => write(filename, content, "index.js"),
  tinybuild: (filename, content) => write(filename, content, "tinybuild.js"),
  config: (filename, content) =>
    write(filename, content ?? template("tinybuild.config.js")),
  package: (filename, content) => {
    const input = content
      ? typeof content === "function"
        ? content()
        : content
      : JSON.parse(template("package.json"));
    const value = typeof input === "object" ? { ...input } : input;
    if (typeof value === "object" && !content)
      value.name =
        path
          .basename(path.dirname(path.resolve(filename)))
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, "-") || "tinybuild-app";
    return writeMissing(
      filename,
      typeof value === "object" ? JSON.stringify(value, null, 2) + "\n" : value,
    );
  },
  tsconfig: (filename, content, entry = "index.js") => {
    const written = writeMissing(
      filename,
      content ||
        template("tsconfig.json").replace(
          /"include":\s*\["index\.js",\s*"tinybuild-env\.d\.ts"\]/,
          '"include": ' + JSON.stringify([entry, "tinybuild-env.d.ts"]),
        ),
    );
    if (written && !content)
      writeMissing(
        path.join(path.dirname(filename), "tinybuild-env.d.ts"),
        template("tinybuild-env.d.ts"),
      );
    return written;
  },
  gitignore: (directory = process.cwd()) =>
    writeMissing(
      path.join(directory, ".gitignore"),
      "node_modules/\ndist/\n.temp/\n.tinybuild/\n.env\n*.pem\n*.key\n*.jks\n",
    ),
  readme: (directory = process.cwd(), content) =>
    write(path.join(directory, "README.md"), content, "README.md"),
  capacitor: (directory = process.cwd()) =>
    writeMissing(
      path.join(directory, "capacitor.config.ts"),
      template("capacitor.config.ts"),
    ),
  electronapp: (directory = process.cwd()) => {
    for (const [from, to] of [
      ["electron_app.js", "electron_app.js"],
      ["electron_preload.js", "electron_preload.js"],
      ["electron_index.html", "index.html"],
      ["electron_package.json", "package.json"],
    ])
      writeMissing(path.join(directory, to), template(from));
  },
  tauriapp: (directory = process.cwd()) =>
    copyFolderSync("src-tauri", path.join(directory, "src-tauri")),
};
create.exportPackage = create.package;
create.templates = Object.fromEntries(
  [
    "index.js",
    "tinybuild.js",
    "tinybuild.config.js",
    "package.json",
    "tsconfig.json",
  ].map((filename) => [filename, () => template(filename)]),
);
export default create;
