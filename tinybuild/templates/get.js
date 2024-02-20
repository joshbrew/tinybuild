import { readFile, readFileSync, cpSync } from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';

if(typeof import.meta !== 'undefined') {
    globalThis.__filename = fileURLToPath(new URL(import.meta.url));
    globalThis.__dirname = fileURLToPath(new URL('.', import.meta.url));
}

export const getTemplate = async (filename) => {
    return await readFile(
        path.join(globalThis.__dirname, filename)
    )
}

export const getTemplateSync =  (filename) => {
    return readFileSync(
        path.join(globalThis.__dirname, filename)
    )
}

export const copyFolderSync =  (folderName, dest) => {
    return cpSync(path.join(globalThis.__dirname,folderName), dest, {recursive:true});
}