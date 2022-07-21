import { readFile, readFileSync } from 'fs';

export const getTemplate = async (filename) => {
    return await readFile(
        new URL(`./${filename}`, import.meta.url)
    )
}

export const getTemplateSync =  (filename) => {
    return readFileSync(
        new URL(`./${filename}`, import.meta.url)
    )
}
