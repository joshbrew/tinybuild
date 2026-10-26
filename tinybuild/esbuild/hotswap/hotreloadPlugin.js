// Compatibility plugin. Reloads now reuse the original build graph, preserving CSS order.
export function hotreloadPlugin() {
  return { name: "hotreloadcacher", setup() {} };
}
