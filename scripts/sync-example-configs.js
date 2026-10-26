import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { format } from "prettier";

const repository = fileURLToPath(new URL("../", import.meta.url));
const skippedDirectories = new Set([
  "node_modules",
  "dist",
  "android",
  "ios",
  "electron",
  "src-tauri",
  "mobile_dist",
]);

export async function exampleConfigs(
  directory = path.join(repository, "examples"),
) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !skippedDirectories.has(entry.name))
      files.push(...(await exampleConfigs(path.join(directory, entry.name))));
    else if (entry.isFile() && entry.name === "tinybuild.config.js")
      files.push(path.join(directory, entry.name));
  }
  return files.sort();
}

function parse(source) {
  const file = ts.createSourceFile(
    "tinybuild.config.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (file.parseDiagnostics.length)
    throw new Error("Cannot annotate an invalid config");
  const exported = file.statements.find(ts.isExportAssignment);
  let object = exported?.expression;
  if (object && ts.isIdentifier(object)) {
    const name = object.text;
    object = file.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .find(
        (declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === name,
      )?.initializer;
  }
  if (!object || !ts.isObjectLiteralExpression(object))
    throw new Error("Expected a default-exported config object");
  return { file, object };
}

function property(object, name) {
  return object.properties.find(
    (value) => ts.isPropertyAssignment(value) && value.name?.text === name,
  );
}

function referenceBlock(name, lines) {
  return [
    `// tinybuild:reference:${name}:start`,
    ...lines,
    `// tinybuild:reference:${name}:end`,
  ].join("\n");
}

function removeReferences(source) {
  const { file } = parse(source);
  const comments = new Map();
  function collect(node) {
    for (const range of [
      ...(ts.getLeadingCommentRanges(source, node.pos) || []),
      ...(ts.getTrailingCommentRanges(source, node.end) || []),
    ])
      comments.set(range.pos, range);
    for (const child of node.getChildren(file)) collect(child);
  }
  collect(file);
  const ranges = [...comments.values()].sort((a, b) => a.pos - b.pos);
  const removals = [];
  let inside = false;
  for (const range of ranges) {
    const comment = source.slice(range.pos, range.end);
    if (/^\/\/ tinybuild:reference:\w+:start$/.test(comment)) inside = true;
    if (inside) removals.push(range);
    if (/^\/\/ tinybuild:reference:\w+:end$/.test(comment)) inside = false;
  }
  for (const range of removals.reverse())
    source = source.slice(0, range.pos) + source.slice(range.end);
  return source;
}

// Only documentation is replaced. Active example code, imports, plugins and macros
// remain editable outside these blocks; the template is the single reference source.
export async function annotateExampleConfig(source, template) {
  source = removeReferences(source).trimStart();
  // Keep even short active option objects on separate lines in the examples.
  // Prettier preserves objects whose opening brace is followed by a newline.
  const breaks = [];
  function expand(node) {
    if (ts.isObjectLiteralExpression(node) && node.properties.length) {
      const at = node.getStart() + 1;
      if (!/^\s*\n/.test(source.slice(at))) breaks.push(at);
    }
    ts.forEachChild(node, expand);
  }
  expand(parse(source).object);
  for (const at of breaks.sort((a, b) => b - a))
    source = source.slice(0, at) + "\n" + source.slice(at);
  const { object } = parse(source);
  const reference = parse(template);
  const templateBundler = property(reference.object, "bundler");
  const templateServer = property(reference.object, "server");
  if (
    !templateBundler ||
    !templateServer ||
    !ts.isObjectLiteralExpression(templateBundler.initializer) ||
    !ts.isObjectLiteralExpression(templateServer.initializer)
  )
    throw new Error(
      "Expected bundler and server reference objects in the template",
    );
  const edits = [];
  const rootBlocks = [];
  // Preserve the template's blank lines and nested indentation in each reference.
  const sectionLines = (text) => {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    const indent = Math.min(
      ...lines
        .filter((line) => line.trim())
        .map((line) => line.match(/^ */)[0].length),
    );
    return lines.map((line) => (line.trim() ? line.slice(indent) : ""));
  };
  const commentLines = (text) =>
    sectionLines(text).map((line) =>
      !line ? "" : line.trimStart().startsWith("//") ? line : `// ${line}`,
    );
  for (const [name, templateProperty] of [
    ["bundler", templateBundler],
    ["server", templateServer],
  ]) {
    const templateObject = templateProperty.initializer;
    const contents = template.slice(
      templateObject.getStart() + 1,
      templateObject.end - 1,
    );
    const lines = [
      ...commentLines(
        template
          .slice(templateProperty.pos, templateProperty.getStart())
          .trim()
          .split(/\n\s*\n/)
          .at(-1),
      ),
      ...commentLines(contents),
    ];
    const active = property(object, name)?.initializer;
    const objects =
      active && ts.isObjectLiteralExpression(active)
        ? [active]
        : active && ts.isArrayLiteralExpression(active)
          ? active.elements.filter(ts.isObjectLiteralExpression)
          : [];
    if (objects.length) {
      for (const target of objects)
        edits.push({
          at: target.end - 1,
          text:
            "\n\n" +
            referenceBlock(name, [
              "// Full option reference. Edit an existing key above instead of adding it twice.",
              ...lines,
            ]) +
            "\n",
        });
    } else {
      rootBlocks.push(
        referenceBlock(name, [
          `// To enable ${name}, replace ${name}: false with this object (or add it if absent).`,
          `// ${name}: {`,
          ...commentLines(
            template
              .slice(templateProperty.pos, templateProperty.getStart())
              .trim()
              .split(/\n\s*\n/)
              .at(-1),
          ).map((line) => "//   " + line),
          ...sectionLines(contents).map((line) =>
            line ? `//   ${line}` : "//",
          ),
          "// },",
        ]),
      );
    }
  }
  rootBlocks.push(
    referenceBlock("options", [
      "// More options. Edit existing keys above; uncomment only the features you need.",
      "// If this example calls nativeApp(...), edit its options there when using the macro.",
      ...commentLines(
        template.slice(templateServer.end + 1, reference.object.end - 1),
      ),
    ]),
  );
  const modes = template
    .slice(reference.object.getStart() + 1, templateBundler.getStart())
    .trim()
    .split(/\n\s*\n/)
    .slice(0, -1)
    .join("\n\n");
  if (modes)
    edits.push({
      at: object.getStart() + 1,
      text: "\n" + referenceBlock("modes", commentLines(modes)) + "\n",
    });
  edits.push({
    at: object.end - 1,
    text: "\n\n" + rootBlocks.join("\n\n") + "\n",
  });
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    const before = source.slice(0, edit.at).trimEnd();
    source = before + edit.text + source.slice(edit.at);
  }
  const header = template
    .slice(0, reference.file.statements[0].getStart())
    .trim();
  source =
    referenceBlock("guide", [
      header,
      "// This example includes the full default reference; its active settings implement the demo.",
      "// Reference blocks are refreshed by npm run sync:example-configs in the repository root.",
    ]) +
    "\n" +
    source;
  return format(source, { parser: "babel", endOfLine: "lf" });
}

export function annotateReadmeConfig(source, template) {
  source = source.replace(/\r\n/g, "\n");
  const start = "<!-- tinybuild:config:start -->";
  const end = "<!-- tinybuild:config:end -->";
  const from = source.indexOf(start),
    to = source.indexOf(end);
  if (
    from < 0 ||
    to < from ||
    source.indexOf(start, from + start.length) >= 0 ||
    source.indexOf(end, to + end.length) >= 0
  )
    throw new Error(
      "README requires one complete tinybuild config reference block",
    );
  return (
    source.slice(0, from + start.length) +
    "\n\n```js\n" +
    template.replace(/\r\n/g, "\n").trim() +
    "\n```\n\n" +
    source.slice(to)
  );
}

export async function syncExampleConfigs({ check = false } = {}) {
  const template = await fs.readFile(
    path.join(repository, "tinybuild/templates/tinybuild.config.js"),
    "utf8",
  );
  const stale = [];
  const files = await exampleConfigs();
  for (const filename of files) {
    const source = await fs.readFile(filename, "utf8");
    const annotated = await annotateExampleConfig(source, template);
    if (annotated !== source.replace(/\r\n/g, "\n")) {
      stale.push(path.relative(repository, filename));
      if (!check) await fs.writeFile(filename, annotated);
    }
  }
  const readme = path.join(repository, "README.md");
  const source = await fs.readFile(readme, "utf8");
  const annotated = annotateReadmeConfig(source, template);
  if (annotated !== source.replace(/\r\n/g, "\n")) {
    stale.push("README.md");
    if (!check) await fs.writeFile(readme, annotated);
  }
  return { files, stale };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const check = process.argv.includes("--check");
  const { files, stale } = await syncExampleConfigs({ check });
  if (check && stale.length) {
    console.error(
      "Example references need updating. Run npm run sync:example-configs:\n" +
        stale.join("\n"),
    );
    process.exitCode = 1;
  } else
    console.log(
      `${check ? "Checked" : "Updated"} full config references in ${files.length} examples and README.`,
    );
}
