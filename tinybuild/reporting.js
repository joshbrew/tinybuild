import { AsyncLocalStorage } from "node:async_hooks";
export const outputContext = new AsyncLocalStorage();
export const schemaVersion = 1;
export function resultRecord(command, data, ok = data?.ok ?? true) {
  return { schemaVersion, command, ok, data };
}
export function errorRecord(command, error) {
  return {
    schemaVersion,
    command,
    ok: false,
    error: { code: error.code || "TINYBUILD_ERROR", message: error.message },
  };
}
