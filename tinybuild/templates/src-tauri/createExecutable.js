import fs from 'node:fs';
import execa from 'execa';

/**
 * This function is used to rename the binary with the platform specific postfix.
 * When `tauri build` is ran, it looks for the binary name appended with the platform specific postfix.
 */

async function moveBinaries() {
  let extension = '';

  if (process.platform === 'win32') {
    extension = '.exe'
  }

  const rustInfo = (await execa('rustc', ['-vV'])).stdout;
  const targetTriple = /host: (\S+)/g.exec(rustInfo)[1];

  if (!targetTriple) {
    console.error('Failed to determine platform target triple')
  }

  fs.renameSync(
    `src-tauri/binaries/app${extension}`,
    `src-tauri/binaries/app-${targetTriple}${extension}`
  );
}


/**
 * This function is used to create single executable from server file and nodejs
 */
async function createServerPackage() {
    return execa(
      'node_modules/.bin/pkg', 
      ['package.json', '--output', 'src-tauri/binaries/app']
    );
  }
  

async function main() {
    try {
      await createServerPackage();
      await moveBinaries();
    } catch (e) {
      throw e;
    }
  }

  main.then(() => { console.log('[tauri] Binaries created\n') }).catch(() => { console.log('[tauri] Cannot build binaries'); })