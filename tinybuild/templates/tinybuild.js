import { packager } from "tinybuild";
import config from "./tinybuild.config.js";
const app = await packager(config);
process.once("SIGINT", () => app.close());
process.once("SIGTERM", () => app.close());
