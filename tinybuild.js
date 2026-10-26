export * from "./tinybuild/packager.js";
export { runTinybuild } from "./tinybuild/cli.js";
import { pathToFileURL } from "node:url";
// Direct script execution remains supported; importing the package is inert.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { main } = await import("./tinybuild/cli.js");
  await main();
}
