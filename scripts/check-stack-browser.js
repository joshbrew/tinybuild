import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { loadConfig } from "../tinybuild/config.js";
import { packager } from "../tinybuild/packager.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const names = process.argv.includes("--stack")
  ? process.argv[process.argv.indexOf("--stack") + 1].split(",")
  : ["uplot-webgpu", "vibe_code_experiments/noiseCompute"];
const browser = await chromium.launch({
  ...(process.env.TINYBUILD_BROWSER
    ? { executablePath: process.env.TINYBUILD_BROWSER }
    : process.platform === "win32"
      ? { channel: "chrome" }
      : {}),
  headless: true,
});
const report = [];
try {
  for (const name of names) {
    if (!["uplot-webgpu", "vibe_code_experiments/noiseCompute"].includes(name))
      throw new Error("Unknown browser stack");
    const cwd = path.join(root, ".test-stacks", name);
    const config = await loadConfig("tinybuild.config.js", cwd, true);
    let app;
    const restored = [];
    const result = { name, pages: [], status: "passed" };
    report.push(result);
    try {
      app = await packager(config, { cwd });
      for (const suffix of name === "uplot-webgpu"
        ? [""]
        : ["", "?demo=planet"]) {
        const page = await browser.newPage({
          viewport: { width: 1280, height: 800 },
        });
        const errors = [],
          consoleErrors = [],
          failures = [],
          workers = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("response", (response) => {
          if (response.status() >= 400)
            failures.push({ url: response.url(), status: response.status() });
        });
        page.on("worker", (worker) => workers.push(worker.url().slice(0, 100)));
        const record = {
          path: "/" + suffix,
          errors,
          consoleErrors,
          failures,
          workers,
        };
        result.pages.push(record);
        try {
          await page.goto(app.server.url + "/" + suffix, {
            waitUntil: "domcontentloaded",
          });
          record.gpu = await page.evaluate(async () => {
            const adapter = await navigator.gpu?.requestAdapter();
            return adapter
              ? {
                  available: true,
                  vendor: adapter.info?.vendor,
                  architecture: adapter.info?.architecture,
                }
              : { available: false };
          });
          if (!record.gpu.available)
            throw new Error("No WebGPU adapter is available in this browser");
          if (name === "uplot-webgpu") {
            await page.waitForFunction(
              () =>
                document.querySelector('[data-action="run"]')?.disabled ===
                  false && document.querySelectorAll("canvas").length >= 2,
              null,
              { timeout: 60000 },
            );
            record.gallery = await page
              .locator("[data-results] tr")
              .evaluateAll((rows) =>
                rows
                  .map((row) => {
                    try {
                      return JSON.parse(row.dataset.result || "null");
                    } catch {
                      return null;
                    }
                  })
                  .filter(Boolean),
              );
            if (record.gallery.some((row) => row.error))
              throw new Error("Visual gallery contains failed cases");
            await page
              .locator('[data-action="runLiveDashboardWebGPU"]')
              .first()
              .click();
            await page.waitForFunction(
              () =>
                document.querySelector('[data-mode="live-demo"]') &&
                document.querySelectorAll("canvas").length >= 2,
              null,
              { timeout: 60000 },
            );
            await page.waitForTimeout(5000);
            await page.locator('[data-action="stop"]').first().click();
            await page.waitForFunction(
              () =>
                document.querySelector('[data-action="run"]')?.disabled ===
                false,
              null,
              { timeout: 60000 },
            );
            record.live = await page
              .locator("[data-results] tr")
              .evaluateAll((rows) =>
                rows
                  .map((row) => {
                    try {
                      return JSON.parse(row.dataset.result || "null");
                    } catch {
                      return null;
                    }
                  })
                  .filter(Boolean),
              );
            if (
              !workers.length ||
              !record.live.length ||
              record.live.some((row) => row.error)
            )
              throw new Error(
                "Live worker dashboard did not produce successful results",
              );
          } else if (suffix) {
            await page.waitForFunction(
              () =>
                window.noisePlanetTestRender &&
                /Rendered in/.test(
                  window.noisePlanetTestRender.ui.status.textContent,
                ),
              null,
              { timeout: 120000 },
            );
            record.renderStatus = await page.evaluate(
              () => window.noisePlanetTestRender.ui.status.textContent,
            );
          } else {
            await page.waitForFunction(
              () =>
                window.cloudStartupTiming?.complete &&
                window.cloudStartupTiming.milestones?.some(
                  (mark) => mark.name === "full-quality-frame-visible",
                ),
              null,
              { timeout: 120000 },
            );
            record.renderStatus = await page.evaluate(
              () => window.cloudStartupTiming,
            );
          }
          record.canvasCount = await page.locator("canvas").count();
          record.body = (await page.locator("body").innerText()).slice(
            0,
            15000,
          );
          const filename =
            name.replaceAll("/", "-") + (suffix ? "-planet" : "") + ".png";
          await page.screenshot({
            path: path.join(root, ".test-stacks", filename),
          });
          if (name === "uplot-webgpu" || suffix) {
            const entry = path.resolve(cwd, config.bundler.entryPoints[0]);
            const original = await fs.readFile(entry);
            const probe = path.join(cwd, "tinybuild-stack-check-probe.js");
            await fs.writeFile(probe, "export const probe = true;\n", {
              flag: "wx",
            });
            restored.push({ entry, original, probe });
            let loads = 0;
            page.on("load", () => loads++);
            const revision = Date.now();
            await fs.writeFile(
              entry,
              original.toString() +
                "\nglobalThis.__tinybuildStackRevision=" +
                revision +
                ";\n",
            );
            await page.waitForFunction(
              (expected) => globalThis.__tinybuildStackRevision === expected,
              revision,
              { timeout: 30000 },
            );
            await page.waitForTimeout(1000);
            if (loads !== 1)
              throw new Error(
                "Expected one page reload for a two-file save; got " + loads,
              );
            record.hotReload = {
              loads,
              url: page.url(),
              server: app.server.url,
            };
          }
          if (errors.length || consoleErrors.length || failures.length)
            throw new Error("Browser reported script, GPU, or resource errors");
        } catch (error) {
          record.error = error.message;
          record.body = (await page.locator("body").innerText()).slice(
            0,
            15000,
          );
          result.status = "failed";
        } finally {
          await page.close();
        }
      }
    } catch (error) {
      result.status = "failed";
      result.error = error.message;
    } finally {
      await app?.close();
      for (const { entry, original, probe } of restored) {
        await fs.writeFile(entry, original);
        await fs.unlink(probe);
      }
    }
    await fs.writeFile(
      path.join(root, ".test-stacks/browser-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(result.status.toUpperCase() + " " + name);
  }
} finally {
  await browser.close();
}
if (report.some((item) => item.status !== "passed")) process.exitCode = 1;
