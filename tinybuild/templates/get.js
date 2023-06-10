import { readFile, readFileSync } from 'fs';
import path from 'path';

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
