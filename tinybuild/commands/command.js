import * as commands from "./index.js";
import { json } from "./utils.js";
const transforms = new Map(
  Object.entries({
    ...commands.basic,
    ...commands.bundler,
    ...commands.server,
  }),
);
export const set = (name, transform = json) => transforms.set(name, transform);
export function get(args = process.argv.slice(2)) {
  if (args === process.argv) args = args.slice(2);
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === "--") break;
    const dashed = token.startsWith("--");
    const text = token.replace(/^--/, "");
    const equals = text.indexOf("=");
    let key = equals < 0 ? text : text.slice(0, equals);
    let value = equals < 0 ? true : text.slice(equals + 1);
    if (dashed && key.startsWith("no-")) {
      key = key.slice(3);
      value = false;
    } else if (
      dashed &&
      equals < 0 &&
      args[index + 1] &&
      !args[index + 1].startsWith("--") &&
      !args[index + 1].includes("=")
    ) {
      if (
        !commands.booleanOptions.has(key) ||
        /^(true|false)$/.test(args[index + 1])
      )
        value = args[++index];
    }
    if (!key || ["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("Invalid option: " + key);
    result[key] = value;
  }
  return result;
}
export function check(args) {
  return Object.fromEntries(
    Object.entries(get(args)).map(([key, value]) => [
      key,
      (transforms.get(key) || json)(value),
    ]),
  );
}
export function parseArgs(args) {
  const values = check(args);
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === "config") {
      if (value === true) {
        result.configure = true;
        continue;
      }
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("config must be a JSON object");
      continue;
    }
    if (Object.hasOwn(commands.basic, key))
      result[key === "bundle" ? "build" : key] = value;
    else if (Object.hasOwn(commands.server, key))
      (result.server ??= {})[key] = value;
    else if (Object.hasOwn(commands.bundler, key))
      (result.bundler ??= {})[key] = value;
    else result[key] = value;
  }
  const inline = values.config === true ? {} : values.config || {};
  return {
    ...inline,
    ...result,
    ...(inline.bundler || result.bundler
      ? { bundler: { ...inline.bundler, ...result.bundler } }
      : {}),
    ...(inline.server || result.server
      ? { server: { ...inline.server, ...result.server } }
      : {}),
  };
}
