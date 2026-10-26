export const exists = () => true;
export function json(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return Number(text);
  if (/^(true|false|null)$/.test(text) || /^[\[{"]/.test(text))
    return JSON.parse(text);
  return value;
}
export const uri = (value) => json(decodeURIComponent(value));
export function list(value) {
  const parsed = json(value);
  return Array.isArray(parsed)
    ? parsed
    : String(parsed)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}
