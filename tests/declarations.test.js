import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleTypes } from "../tinybuild/esbuild/bundler.js";
import { fixture } from "./helpers.js";

for (const [version, name] of [
  [5, "typescript5"],
  [6, "typescript"],
  [7, "typescript7"],
]) {
  test(`TypeScript ${version} declarations preserve CSS, ambient types, maps, write:false and failed-build output`, async (t) => {
    const original = JSON.stringify({
      include: ["src/main.ts"],
      compilerOptions: {
        noEmit: true,
        rootDir: "src",
        declarationMap: true,
        types: ["demo"],
        noUncheckedSideEffectImports: true,
        module: "ESNext",
        moduleResolution: "Bundler",
      },
    });
    const cwd = await fixture(t, {
      "src/main.ts":
        'import "./style.css";export function answer():number{return 42;}export type Token=GlobalToken;',
      "src/style.css": "body{color:red}",
      "node_modules/@types/demo/index.d.ts":
        "interface GlobalToken {value:string}",
      "tsconfig.json": original,
    });
    await fs.symlink(
      fileURLToPath(new URL(`../node_modules/${name}`, import.meta.url)),
      path.join(cwd, "node_modules/typescript"),
      "junction",
    );
    const config = {
      absWorkingDir: cwd,
      entryPoints: ["src/main.ts"],
      outfile: "dist/main",
      write: false,
    };
    const preview = await bundleTypes(config);
    assert.ok(
      preview.outputs.some((file) => file.text.includes("answer(): number")),
    );
    assert.ok(
      preview.outputs.some((file) => file.text.includes("Token = GlobalToken")),
    );
    const mapFile = preview.outputs.find((file) =>
      file.path.endsWith(".d.ts.map"),
    );
    const map = JSON.parse(mapFile.text);
    assert.equal(
      path.resolve(
        path.dirname(mapFile.path),
        map.sourceRoot || "",
        map.sources[0],
      ),
      path.join(cwd, "src/main.ts"),
    );
    await assert.rejects(fs.access(path.join(cwd, "dist")), { code: "ENOENT" });
    assert.equal(
      await fs.readFile(path.join(cwd, "tsconfig.json"), "utf8"),
      original,
    );
    const emitted = await bundleTypes({ ...config, write: true });
    for (const output of emitted.outputs)
      assert.equal(await fs.readFile(output.path, "utf8"), output.text);
    const published = await fs.readFile(
      path.join(cwd, "dist/main.d.ts"),
      "utf8",
    );
    await fs.writeFile(
      path.join(cwd, "src/main.ts"),
      'export const answer:number="wrong";',
    );
    await assert.rejects(
      bundleTypes({ ...config, write: true }),
      /not assignable/,
    );
    assert.equal(
      await fs.readFile(path.join(cwd, "dist/main.d.ts"), "utf8"),
      published,
    );
    assert.deepEqual((await fs.readdir(cwd)).sort(), [
      "dist",
      "node_modules",
      "src",
      "tsconfig.json",
    ]);
  });

  test(`TypeScript ${version} declarations support JavaScript entries without a tsconfig`, async (t) => {
    const cwd = await fixture(t, {
      "main.js": 'export const message="hello";',
    });
    await fs.mkdir(path.join(cwd, "node_modules"));
    await fs.symlink(
      fileURLToPath(new URL(`../node_modules/${name}`, import.meta.url)),
      path.join(cwd, "node_modules/typescript"),
      "junction",
    );
    const result = await bundleTypes({
      absWorkingDir: cwd,
      entryPoints: ["main.js"],
      outdir: "types",
      write: false,
    });
    assert.ok(result.outputs.some((file) => file.text.includes("message")));
    await assert.rejects(fs.access(path.join(cwd, "types")), {
      code: "ENOENT",
    });
  });
  test(`TypeScript ${version} accepts an existing declaration entry without creating output`, async (t) => {
    const cwd = await fixture(t, {
      "main.d.ts": "export declare const answer:number;",
    });
    await fs.mkdir(path.join(cwd, "node_modules"));
    await fs.symlink(
      fileURLToPath(new URL(`../node_modules/${name}`, import.meta.url)),
      path.join(cwd, "node_modules/typescript"),
      "junction",
    );
    assert.deepEqual(
      (
        await bundleTypes({
          absWorkingDir: cwd,
          entryPoints: ["main.d.ts"],
          outdir: "dist",
        })
      ).outputs,
      [],
    );
    await assert.rejects(fs.access(path.join(cwd, "dist")), { code: "ENOENT" });
  });
}

test("TypeScript 7 preserves remote declaration-map source roots", async (t) => {
  const cwd = await fixture(t, {
    "src/main.ts": "export const answer:number=42;",
    "tsconfig.json": JSON.stringify({
      include: ["src/main.ts"],
      compilerOptions: {
        rootDir: "src",
        declarationMap: true,
        sourceRoot: "https://example.test/source/",
        sourceMap: true,
      },
    }),
  });
  await fs.mkdir(path.join(cwd, "node_modules"));
  await fs.symlink(
    fileURLToPath(new URL("../node_modules/typescript7", import.meta.url)),
    path.join(cwd, "node_modules/typescript"),
    "junction",
  );
  const result = await bundleTypes({
    absWorkingDir: cwd,
    outdir: "dist",
    write: false,
  });
  const map = JSON.parse(
    result.outputs.find((file) => file.path.endsWith(".map")).text,
  );
  assert.equal(map.sourceRoot, "https://example.test/source/");
  assert.deepEqual(map.sources, ["main.ts"]);
});
