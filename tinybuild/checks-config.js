import path from "node:path";
export function validateChecks(checks = {}) {
  if (!checks || typeof checks !== "object" || Array.isArray(checks))
    throw new Error("checks must be an object");
  for (const key of Object.keys(checks))
    if (!["files", "urls", "timeout"].includes(key))
      throw new Error("Unknown checks option: " + key);
  if (
    checks.files !== undefined &&
    (!Array.isArray(checks.files) ||
      checks.files.some(
        (file) =>
          typeof file !== "string" ||
          !file ||
          path.isAbsolute(file) ||
          path.win32.isAbsolute(file) ||
          file.split(/[\\/]/).includes(".."),
      ))
  )
    throw new Error(
      "checks.files must contain project-relative paths without ..",
    );
  if (
    checks.timeout !== undefined &&
    (!Number.isInteger(checks.timeout) ||
      checks.timeout < 1 ||
      checks.timeout > 300000)
  )
    throw new Error("checks.timeout must be 1..300000 milliseconds");
  if (
    checks.urls !== undefined &&
    (!Array.isArray(checks.urls) ||
      checks.urls.some(
        (url) =>
          !url ||
          typeof url !== "object" ||
          typeof url.path !== "string" ||
          !url.path.startsWith("/") ||
          url.path.startsWith("//") ||
          /[\\\r\n]/.test(url.path) ||
          Object.keys(url).some(
            (key) => !["path", "status", "includes"].includes(key),
          ) ||
          (url.status !== undefined &&
            (!Number.isInteger(url.status) ||
              url.status < 100 ||
              url.status > 599)) ||
          (url.includes !== undefined && typeof url.includes !== "string"),
      ))
  )
    throw new Error(
      "checks.urls requires local paths, optional HTTP status and includes text",
    );
}
