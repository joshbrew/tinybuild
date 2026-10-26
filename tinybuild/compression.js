import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(gzip);
export const compressibleFile = (filename) =>
  /\.(?:[cm]?js|css|html?|json|map|svg|txt|xml|webmanifest|wasm)$/i.test(
    filename,
  );

// Keep originals usable from disk and in native shells; gzip is an extra output.
export async function gzipOutputs(result, options) {
  const files = new Set([
    ...Object.keys(result.metafile.outputs).map((file) =>
      path.resolve(options.absWorkingDir, file),
    ),
    ...(result.htmlFiles || []),
  ]);
  const generated = [];
  for (const filename of files) {
    if (!compressibleFile(filename)) continue;
    const data = await compress(await fs.readFile(filename), { level: 9 });
    const destination = filename + ".gz";
    const temporary = destination + "." + randomUUID() + ".tinybuild-gzip.tmp";
    try {
      await fs.writeFile(temporary, data, { flag: "wx" });
      await fs.rename(temporary, destination);
    } finally {
      await fs.unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    generated.push(destination);
  }
  return generated;
}

// An absent Accept-Encoding asks for an ordinary response. Explicit exclusions,
// wildcard exclusions and relative preferences are respected when choosing gzip.
export function encodingPreferences(header) {
  const values = new Map();
  for (const item of String(header || "").split(",")) {
    const [name, ...parameters] = item.trim().toLowerCase().split(";");
    if (!name) continue;
    const parameter = parameters
      .map((value) => value.trim())
      .find((value) => value.startsWith("q="));
    const text = parameter?.slice(2);
    const quality =
      text === undefined
        ? 1
        : /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(text)
          ? Number(text)
          : 0;
    values.set(name, quality);
  }
  return {
    gzip: values.get("gzip") ?? values.get("*") ?? 0,
    identity: values.get("identity") ?? (values.get("*") === 0 ? 0 : 1),
  };
}

export function varyEncoding(headers) {
  const name =
    Object.keys(headers).find((key) => key.toLowerCase() === "vary") || "Vary";
  const values = String(headers[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !values.some(
      (value) => value === "*" || value.toLowerCase() === "accept-encoding",
    )
  )
    values.push("Accept-Encoding");
  headers[name] = values.join(", ");
}
