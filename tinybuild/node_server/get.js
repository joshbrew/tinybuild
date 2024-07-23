import { readFile, readFileSync, cpSync } from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';

//this helps with local file copying when using this script globally and also some inconsistency between esm and cjs for relpath stuff

if(typeof import.meta !== 'undefined') {
    globalThis.__nfilename = fileURLToPath(new URL(import.meta.url));
    globalThis.__ndirname = fileURLToPath(new URL('.', import.meta.url));
    if(!globalThis.__filename) {
        globalThis.__filename = globalThis.__nfilename;
        globalThis.__dirname = globalThis.__ndirname;
    }
}

export const getPath = (filename) => {
    return path.join(globalThis.__ndirname, filename);
}

export const getTemplate = async (filename) => {
    return await readFile(
        path.join(globalThis.__ndirname, filename)
    )
}

export const getTemplateSync = (filename) => {
    return readFileSync(
        path.join(globalThis.__ndirname, filename)
    )
}

export const copyFolderSync =  (folderName, dest) => {
    return cpSync(path.join(globalThis.__ndirname,folderName), dest, {recursive:true});
}