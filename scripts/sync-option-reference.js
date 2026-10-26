import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { format } from "prettier";
import { optionReference } from "../tinybuild/option-reference.js";
const root = fileURLToPath(new URL("../", import.meta.url));
export async function syncOptionReference({ check = false } = {}) {
  const filename = path.join(root, "tinybuild.d.ts");
  const source = await format(
    (await fs.readFile(filename, "utf8")).replace(
      /\s*\/\*\*(?:(?!\*\/)[\s\S])*?@tinybuildOption [^\n]+\n\s*\*\//g,
      "\n",
    ),
    { parser: "typescript" },
  );
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const groups = {
    Config: "",
    BundlerConfig: "bundler",
    ServerConfig: "server",
    NativeApp: "native",
    TaskConfig: "tasks",
    BuildBudgets: "budgets",
    ProjectChecks: "checks",
  };
  const reference = new Map(optionReference().map((item) => [item.path, item]));
  const edits = [],
    types = {};
  for (const statement of file.statements) {
    if (
      !ts.isInterfaceDeclaration(statement) ||
      !Object.hasOwn(groups, statement.name.text)
    )
      continue;
    const group = groups[statement.name.text];
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member) || !member.name || !member.type)
        continue;
      const key = [group, member.name.getText(file)].filter(Boolean).join(".");
      types[key] = member.type.getText(file).replace(/\s+/g, " ");
      const item = reference.get(key);
      if (item?.description && !member.jsDoc?.length)
        edits.push({
          at: member.getStart(file),
          text:
            "/**\n * " +
            item.description.replace(/\*\//g, "* /") +
            "\n * @tinybuildOption " +
            key +
            "\n */\n",
        });
    }
  }
  const esbuildFile = ts.createSourceFile(
    "esbuild.d.ts",
    await fs.readFile(
      new URL("./main.d.ts", import.meta.resolve("esbuild")),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of esbuildFile.statements) {
    if (
      !ts.isInterfaceDeclaration(statement) ||
      !["BuildOptions", "CommonOptions"].includes(statement.name.text)
    )
      continue;
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member) || !member.name || !member.type)
        continue;
      const key = "bundler." + member.name.getText(esbuildFile);
      if (reference.has(key) && !Object.hasOwn(types, key))
        types[key] = member.type.getText(esbuildFile).replace(/\s+/g, " ");
    }
  }
  let output = source;
  for (const edit of edits.sort((a, b) => b.at - a.at))
    output = output.slice(0, edit.at) + edit.text + output.slice(edit.at);
  output = await format(output, { parser: "typescript" });
  const generated = JSON.stringify(types, null, 2) + "\n";
  const typefile = path.join(root, "tinybuild/option-types.json");
  const stale =
    (await fs.readFile(filename, "utf8")).replace(/\r\n/g, "\n") !== output ||
    (await fs.readFile(typefile, "utf8").catch(() => "")) !== generated;
  if (!check) {
    await fs.writeFile(filename, output);
    await fs.writeFile(typefile, generated);
  }
  return stale;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const stale = await syncOptionReference({
    check: process.argv.includes("--check"),
  });
  if (stale && process.argv.includes("--check")) {
    console.error("Refresh option types/comments with npm run sync:options");
    process.exitCode = 1;
  } else console.log("Option documentation is synchronized.");
}
