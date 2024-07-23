import { readFile, readFileSync, cpSync } from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';

if(typeof import.meta !== 'undefined') {
    globalThis.__tfilename = fileURLToPath(new URL(import.meta.url)); //gets relpath for this script file
    globalThis.__tdirname = fileURLToPath(new URL('.', import.meta.url));
    if(!globalThis.__filename) {
        globalThis.__filename = globalThis.__tfilename;
        globalThis.__dirname = globalThis.__tdirname;
    }
}

export const getPath = (filename) => {
    return path.join(globalThis.__tdirname, filename);
}

export const getTemplate = async (filename) => {
    return await readFile(
        path.join(globalThis.__tdirname, filename)
    )
}

export const getTemplateSync =  (filename) => {
    return readFileSync(
        path.join(globalThis.__tdirname, filename)
    )
}

export const copyFolderSync =  (folderName, dest) => {
    return cpSync(path.join(globalThis.__tdirname,folderName), dest, {recursive:true});
}