// hotreloadPlugin.js
// Collect all CSS-like files in the bundle into a temporary index file so they
// can be rebuilt quickly by a separate hot bundle step.

import path from 'path';
import fs from 'fs';

const TEMP_DIR = path.join(process.cwd(), 'node_modules', '.temp');
const CACHE_FILE = '__cachedSubdependencies.js';

function normalizeImportPath(importPath) {
  return importPath.split(path.sep).join('/');
}

function isWindowsAbsolutePath(importPath) {
  return /^[a-zA-Z]:[\\/]/.test(importPath);
}

function isRelativeSpecifier(importPath) {
  return importPath.startsWith('./') || importPath.startsWith('../');
}

function isAbsoluteSpecifier(importPath) {
  return importPath.startsWith('/') || isWindowsAbsolutePath(importPath);
}

function isPathSpecifier(importPath) {
  return isRelativeSpecifier(importPath) || isAbsoluteSpecifier(importPath);
}

function toCacheImportSpecifier(args) {
  if (!isPathSpecifier(args.path)) {
    return normalizeImportPath(args.path);
  }

  const absolutePath = path.isAbsolute(args.path) || isWindowsAbsolutePath(args.path)
    ? path.normalize(args.path)
    : path.resolve(args.resolveDir || process.cwd(), args.path);

  let relativePath = path.relative(TEMP_DIR, absolutePath);
  relativePath = normalizeImportPath(relativePath);

  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }

  return relativePath;
}

function writeFileAtomicIfChanged(filePath, contents) {
  if (fs.existsSync(filePath)) {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current === contents) return;
  }

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, contents);

  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fs.renameSync(tempPath, filePath);
    } catch (renameError) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}
      throw renameError;
    }

    if (error?.code && error.code !== 'EEXIST' && error.code !== 'EPERM') {
      console.warn(`hotreloadcacher recovered from cache replace error ${error.code}`);
    }
  }
}

export function hotreloadPlugin(extnames = ['css', 'sass', 'less', 'scss']) {
  const cleanExtnames = extnames.map(ext => ext.replaceAll('.', ''));
  const filter = new RegExp(`\\.(${cleanExtnames.join('|')})(?:[?#].*)?$`, 'i');

  let collected = new Set();

  return {
    name: 'hotreloadcacher',
    setup(builder) {
      builder.onStart(() => {
        collected.clear();
      });

      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.importer?.includes(`${path.sep}node_modules${path.sep}.temp${path.sep}`)) return;
        if (!filter.test(args.path)) return;

        collected.add(toCacheImportSpecifier(args));
        return;
      });

      builder.onEnd(() => {
        if (!fs.existsSync(TEMP_DIR)) {
          fs.mkdirSync(TEMP_DIR, { recursive: true });
        }

        const indexSrc = [...collected]
          .sort()
          .map(specifier => `import ${JSON.stringify(specifier)};`)
          .join('\n');

        const cachePath = path.join(TEMP_DIR, CACHE_FILE);
        writeFileAtomicIfChanged(cachePath, indexSrc);
      });
    },
  };
}
