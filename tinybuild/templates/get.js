import { readFile } from 'fs/promises';

const getTemplate = async (filename) => {
    return await readFile(
        new URL(`./${filename}`, import.meta.url)
    )
}

const getTemplateSync =  (filename) => {
    return readFileSync(
        new URL(`./${filename}`, import.meta.url)
    )
}

export default getTemplate