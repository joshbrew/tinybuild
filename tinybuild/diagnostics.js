import path from "node:path";
import fs from "node:fs/promises";
import { gzip, brotliCompress } from "node:zlib";
import { promisify } from "node:util";
import { bundle, createBuildContexts } from "./esbuild/bundler.js";

export async function analyzeBuild(
  results,
  { budgets = {}, cwd = process.cwd(), compression = false, baseline } = {},
) {
  const outputs = new Map();
  const contents = new Map();
  const inputs = new Map();
  const compressedFiles = new Map();
  for (const group of results) {
    const root = group.config?.absWorkingDir || cwd;
    for (const [target, result] of Object.entries(group)) {
      if (!result?.metafile) continue;
      for (const filename of result.gzipFiles || [])
        compressedFiles.set(
          path.resolve(root, filename.slice(0, -3)),
          filename,
        );
      for (const output of result.outputFiles || [])
        contents.set(path.resolve(root, output.path), output.contents);
      for (const [filename, info] of Object.entries(result.metafile.inputs)) {
        const key = root + "\0" + filename;
        inputs.set(key, {
          path: filename,
          bytes: info.bytes,
          imports: info.imports.map(({ path, external, kind }) => ({
            path,
            external: Boolean(external),
            kind,
          })),
        });
      }
      for (const [filename, info] of Object.entries(result.metafile.outputs)) {
        const absolute = path.resolve(root, filename);
        outputs.set(absolute, {
          path: path.relative(cwd, absolute).split(path.sep).join("/"),
          target,
          bytes: info.bytes,
          entryPoint: info.entryPoint,
          imports: info.imports,
          inputs: info.inputs,
        });
      }
      for (const html of result.htmlFiles ||
        (result.html ? [result.html] : [])) {
        const absolute = path.resolve(root, html);
        outputs.set(absolute, {
          path: path.relative(cwd, absolute).split(path.sep).join("/"),
          target: "html",
          bytes: (await fs.stat(absolute)).size,
          entryPoint: true,
          imports: [],
          inputs: {},
        });
      }
    }
  }
  const files = [...outputs.values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const outputBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  let gzipBytes, brotliBytes, growthBytes;
  if (
    compression ||
    budgets.gzipBytes !== undefined ||
    budgets.brotliBytes !== undefined
  ) {
    await Promise.all(
      files.map(async (file) => {
        const filename = path.resolve(cwd, file.path);
        const data = contents.get(filename) || (await fs.readFile(filename));
        const [gz, br] = await Promise.all([
          compressedFiles.has(filename)
            ? fs.readFile(compressedFiles.get(filename))
            : promisify(gzip)(data),
          promisify(brotliCompress)(data),
        ]);
        file.gzipBytes = gz.length;
        file.brotliBytes = br.length;
      }),
    );
    gzipBytes = files.reduce((sum, file) => sum + file.gzipBytes, 0);
    brotliBytes = files.reduce((sum, file) => sum + file.brotliBytes, 0);
  }
  if (baseline) {
    const data = JSON.parse(
      await fs.readFile(path.resolve(cwd, baseline), "utf8"),
    );
    if (
      data.version !== 1 ||
      !Number.isFinite(data.outputBytes) ||
      data.outputBytes < 0
    )
      throw new Error("Invalid build baseline: " + baseline);
    growthBytes = outputBytes - data.outputBytes;
  } else if (budgets.growthBytes !== undefined)
    throw new Error(
      "growthBytes requires diagnostics.baseline; create it with tinybuild baseline",
    );
  const violations = [];
  for (const name of [
    "totalBytes",
    "entryBytes",
    "gzipBytes",
    "brotliBytes",
    "growthBytes",
  ]) {
    if (
      budgets[name] !== undefined &&
      (!Number.isFinite(budgets[name]) || budgets[name] < 0)
    )
      throw new Error("Invalid build budget: " + name);
  }
  if (budgets.totalBytes !== undefined && outputBytes > budgets.totalBytes)
    violations.push({
      path: "<total>",
      bytes: outputBytes,
      limit: budgets.totalBytes,
    });
  for (const [name, bytes] of Object.entries({
    gzipBytes,
    brotliBytes,
    growthBytes,
  }))
    if (budgets[name] !== undefined && bytes > budgets[name])
      violations.push({ path: "<" + name + ">", bytes, limit: budgets[name] });
  for (const file of files)
    if (
      file.entryPoint &&
      budgets.entryBytes !== undefined &&
      file.bytes > budgets.entryBytes
    )
      violations.push({
        path: file.path,
        bytes: file.bytes,
        limit: budgets.entryBytes,
      });
  if (budgets.onExceed && !["warn", "error"].includes(budgets.onExceed))
    throw new Error("budgets.onExceed must be warn or error");
  const report = {
    outputBytes,
    ...(gzipBytes === undefined ? {} : { gzipBytes, brotliBytes }),
    ...(growthBytes === undefined ? {} : { growthBytes }),
    outputs: files,
    inputs: [...inputs.values()],
    violations,
  };
  if (violations.length && budgets.onExceed === "error") {
    const error = new Error(
      "Build budget exceeded: " +
        violations
          .map(
            (item) =>
              item.path + " (" + item.bytes + " > " + item.limit + " bytes)",
          )
          .join(", "),
    );
    error.report = report;
    throw error;
  }
  return report;
}

export async function benchmarkBuild(
  config,
  { iterations = 5, warmup = 1 } = {},
) {
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 100 ||
    !Number.isInteger(warmup) ||
    warmup < 0 ||
    warmup > 100
  )
    throw new Error("Benchmark iterations must be 1–100 and warmup 0–100");
  const cold = [],
    warm = [];
  const measure = async (fn, values) => {
    const start = performance.now();
    await fn();
    values.push(performance.now() - start);
  };
  // Cold means fresh build contexts; dependency/OS caches are intentionally kept.
  for (let i = 0; i < iterations; i++)
    await measure(() => bundle(config), cold);
  const contexts = await createBuildContexts(config);
  try {
    for (let i = 0; i < warmup; i++) await contexts.rebuild();
    for (let i = 0; i < iterations; i++)
      await measure(() => contexts.rebuild(), warm);
  } finally {
    await contexts.dispose();
  }
  const summarize = (samples) => {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      samples,
      minMs: sorted[0],
      medianMs:
        (sorted[Math.floor((sorted.length - 1) / 2)] +
          sorted[Math.floor(sorted.length / 2)]) /
        2,
      meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    };
  };
  return { iterations, warmup, cold: summarize(cold), warm: summarize(warm) };
}

export async function saveBaseline(
  report,
  filename,
  { cwd = process.cwd() } = {},
) {
  const target = path.resolve(cwd, filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    JSON.stringify(
      {
        version: 1,
        outputBytes: report.outputBytes,
        outputs: report.outputs.map(({ path, bytes }) => ({ path, bytes })),
      },
      null,
      2,
    ) + "\n",
  );
  return target;
}

export async function writeBuildReport(
  report,
  filename,
  { cwd = process.cwd() } = {},
) {
  const target = path.resolve(cwd, filename);
  const data = JSON.stringify(report).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Tinybuild dependency report</title><style>body{font:16px system-ui;max-width:1100px;margin:3rem auto;padding:1rem}input{padding:.7rem;width:90%}table{width:100%;border-collapse:collapse}td,th{padding:.6rem;border-bottom:1px solid #aaa;text-align:left}pre{white-space:pre-wrap}button{cursor:pointer}</style><h1>Build dependencies</h1><p id="summary"></p><label>Search outputs or input dependencies <input id="search" type="search"></label><table><thead><tr><th>Output</th><th>Bytes</th><th>Gzip</th><th>Brotli</th><th>Sources</th></tr></thead><tbody id="outputs"></tbody></table><h2 id="selected">Select an output to inspect its sources</h2><pre id="dependencies"></pre><script type="application/json" id="data">${data}</script><script>const report=JSON.parse(document.getElementById('data').textContent);const outputs=document.getElementById('outputs');document.getElementById('summary').textContent=report.outputBytes+' bytes across '+report.outputs.length+' outputs';function render(){outputs.replaceChildren();const query=document.getElementById('search').value.toLowerCase();for(const file of report.outputs){if(!(file.path+' '+Object.keys(file.inputs).join(' ')).toLowerCase().includes(query))continue;const row=document.createElement('tr');const button=document.createElement('button');button.textContent=file.path;button.onclick=()=>{document.getElementById('selected').textContent=file.path;document.getElementById('dependencies').textContent=Object.entries(file.inputs).map(([path,info])=>path+' ('+(info.bytesInOutput||0)+' bytes)').join('\\n')||'No bundled input dependencies';};for(const value of [button,file.bytes,file.gzipBytes??'—',file.brotliBytes??'—',Object.keys(file.inputs).length]){const cell=document.createElement('td');if(value instanceof Node)cell.append(value);else cell.textContent=value;row.append(cell);}outputs.append(row);}}document.getElementById('search').oninput=render;render();</script></html>`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, html);
  return target;
}
