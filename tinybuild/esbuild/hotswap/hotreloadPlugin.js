// hotreloadPlugin.js
// ──────────────────────────────────────────────────────────────────────────────
// Copy only the first entry-point’s CSS-like sub-dependencies into a temporary
// index file so they can be rebuilt quickly.  All other entry-point graphs are
// ignored – even during incremental rebuilds.

import path from 'path';
import fs   from 'fs';

const TEMP_DIR   = path.join(process.cwd(), 'node_modules', '.temp');
const CACHE_FILE = '__cachedSubdependencies.js';

export function hotreloadPlugin(extnames = ['css', 'sass', 'less', 'scss']) {
  // Matches .css, .sass, ...
  const filter = new RegExp(`\\.(${extnames.join('|').replaceAll('.', '')})$`, 'i');

  // State containers (cleared on every build/rebuild)
  let collected  = new Set();    // paths to cache
  let fromFirst  = new Set();    // graph walk
  let firstEntry = null;         // absolute path

  return {
    name: 'hotreloadcacher',
    setup(builder) {

      // ── 1.  Identify the first entry-point before the graph walk starts ──
      builder.onStart(() => {
        collected.clear();
        fromFirst.clear();

        const eps = builder.initialOptions.entryPoints;
        if (!eps) return;   // no entry points?  nothing to do

        if (typeof eps === 'string')        firstEntry = path.resolve(eps);
        else if (Array.isArray(eps))        firstEntry = path.resolve(eps[0]);
        else if (typeof eps === 'object')   firstEntry = path.resolve(Object.values(eps)[0]);
      });

      // ── 2.  Walk the module graph, but only the first entry-point’s branch ──
      builder.onResolve({ filter: /.*/ }, (args) => {
        // Ignore anything that’s already inside node_modules
        if (args.importer?.includes('node_modules')) return;

        // Resolve absolute path for args.path
        const resolved = path.isAbsolute(args.path)
          ? path.normalize(args.path)
          : path.normalize(path.join(args.resolveDir, args.path));

        // `importer === ''` means “this module is an entry point”
        if (args.importer === '') {
          // Start *only* if this is literally the first entry-point file
          if (resolved === firstEntry) {
            fromFirst.add(resolved);
            if (filter.test(resolved)) collected.add(resolved);
          }
          // For any other entry-point we just bail – no caching for that tree
          return;
        }

        // We’re inside the tree – keep going only if the importer
        // is already known to belong to the first entry-point branch.
        if (fromFirst.has(path.normalize(args.importer))) {
          fromFirst.add(resolved);
          if (filter.test(resolved)) collected.add(resolved);
        }

        // Let esbuild finish its normal resolution
        return;
      });

      // ── 3.  Emit a synthetic file that re-imports the collected assets ──
      builder.onEnd(() => {
        if (!collected.size) return;      // nothing to emit

        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

        const indexSrc = [...collected]
          .map(p => `import '${p.split(path.sep).join('/')}'`)
          .join('\n');

        fs.writeFileSync(path.join(TEMP_DIR, CACHE_FILE), indexSrc);
      });
    },
  };
}
