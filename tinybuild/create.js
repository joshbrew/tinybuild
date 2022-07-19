import fs from 'fs';
import path from 'path';
import getTemplate from "./templates/get.js";

const textDecoder = new TextDecoder();
const entryFileTemplate = textDecoder.decode(await getTemplate('index.js'))
const tinybuildConfigTemplate = textDecoder.decode(await getTemplate('tinybuild.config.js'))
const tinybuildTemplate = textDecoder.decode(await getTemplate('tinybuild.js'))
const defaultInitScript = textDecoder.decode(await getTemplate('initScript.js'))
const packageTemplate = JSON.parse(await getTemplate('package.json'));
const tsconfigTemplate = await getTemplate('tsconfig.json');
const gitignoreTemplate = await getTemplate('getignore.md');

const templates = {
    'index.js': entryFileTemplate,
    'tinybuild.config.js': tinybuildConfigTemplate,
    'tinybuild.js': tinybuildTemplate,
    'initScript.js': defaultInitScript,
    'package.json': packageTemplate,
    'tsconfig.json': tsconfigTemplate,
    '.gitignore': gitignoreTemplate
}

const exportPackage = (location, content=packageTemplate) => {
    const template = Object.assign({}, content)
    console.log('Creating package.json')
    template.name += Math.floor(Math.random()*10000)
    fs.writeFileSync(location, JSON.stringify(template, null, 2));
}

const tsconfig = (location, content=tsconfigTemplate) => {
    fs.writeFileSync(location, content)

}

const entry = (location, content=entryFileTemplate) => {
    fs.writeFileSync(location, content)
}

const config = (location, content=tinybuildConfigTemplate) => {
    let template = new String(content);
    const jsonLocation = path.join(process.cwd(),'package.json')

    if(fs.existsSync(location)) {
        let contents = fs.readFileSync(jsonLocation);
        if(!contents.includes('"module"')) template += '\nmodule.exports = config; //export default config; //es6' //es5
        else template += '\nexport default config; //module.exports = config; //es5' //es6
    } else template += '\nexport default config; //module.exports = config; //es5' //es6
    fs.writeFileSync(location,template);
}

const tinybuild = (location, content=tinybuildTemplate) => {
    fs.writeFileSync(location, content)
}

const initScript = (name, content=defaultInitScript) => {
    fs.writeFileSync(name, content)
}

const gitignore = () => {
    fs.writeFileSync(path.join(dirName,'.gitignore'), gitignoreTemplate)
}

export default {
    gitignore,
    entry,
    config,
    tinybuild,
    initScript,
    exportPackage,
    tsconfig,
    package: exportPackage,
    templates
}