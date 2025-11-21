// hotreloadPlugin.js
// Collect all CSS-like files in the bundle into a temporary index file so they
// can be rebuilt quickly by a separate hot bundle step.

import path from 'path';
import fs   from 'fs';

const TEMP_DIR   = path.join(process.cwd(), 'node_modules', '.temp');
const CACHE_FILE = '__cachedSubdependencies.js';

export function hotreloadPlugin(extnames = ['css', 'sass', 'less', 'scss']) {
  const filter = new RegExp(`\\.(${extnames.join('|').replaceAll('.', '')})$`, 'i');

  let collected = new Set();

  return {
    name: 'hotreloadcacher',
    setup(builder) {

      builder.onStart(() => {
        collected.clear();
      });

      builder.onResolve({ filter: /.*/ }, (args) => {
        // Ignore stuff already inside node_modules
        if (args.importer?.includes('node_modules')) return;

        const resolved = path.isAbsolute(args.path)
          ? path.normalize(args.path)
          : path.normalize(path.join(args.resolveDir, args.path));

        if (filter.test(resolved)) {
          collected.add(resolved);
        }

        return;
      });

      builder.onEnd(() => {
        if (!fs.existsSync(TEMP_DIR)) {
          fs.mkdirSync(TEMP_DIR, { recursive: true });
        }

        const indexSrc = [...collected]
          .map(p => `import '${p.split(path.sep).join('/')}'`)
          .join('\n');

        const cachePath = path.join(TEMP_DIR, CACHE_FILE);
        fs.writeFileSync(cachePath, indexSrc);
      });
    },
  };
}
