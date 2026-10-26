import { readFileSync, cpSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const directory = fileURLToPath(new URL(".", import.meta.url));
export const getPath = (filename) => path.join(directory, filename);
export const getTemplate = (filename) => readFile(getPath(filename));
export const getTemplateSync = (filename) => readFileSync(getPath(filename));
export const copyFolderSync = (folder, destination) =>
  cpSync(getPath(folder), destination, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
