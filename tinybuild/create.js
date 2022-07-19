import fs from 'fs';
import path from 'path';
import getTemplateSync from "./templates/get.js";

//FIX: Don't read the files just to import strings when unused.
const textDecoder = new TextDecoder();
const entryFileTemplate =       ()=>{return textDecoder.decode(getTemplateSync('index.js'))}
const tinybuildConfigTemplate = ()=>{return textDecoder.decode(getTemplateSync('tinybuild.config.js'))}
const tinybuildTemplate =       ()=>{return textDecoder.decode(getTemplateSync('tinybuild.js'))}
const defaultInitScript =       ()=>{return textDecoder.decode(getTemplateSync('initScript.js'))}
const packageTemplate =         ()=>{return JSON.parse(getTemplateSync('package.json'));}
const tsconfigTemplate =        ()=>{return getTemplateSync('tsconfig.json');}
const gitignoreTemplate =       ()=>{return getTemplateSync('gitignore.md');}

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
    if(typeof content === 'function') content = content();
    const template = Object.assign({}, content)
    console.log('Creating package.json')
    template.name += Math.floor(Math.random()*10000)
    fs.writeFileSync(location, JSON.stringify(template, null, 2));
}

const tsconfig = (location, content=tsconfigTemplate) => {
    if(typeof content === 'function') content = content();
    fs.writeFileSync(location, content)

}

const entry = (location, content=entryFileTemplate) => {
    if(typeof content === 'function') content = content();
    fs.writeFileSync(location, content)
}

const config = (location, content=tinybuildConfigTemplate) => {
    if(typeof content === 'function') content = content();
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
    if(typeof content === 'function') content = content();
    fs.writeFileSync(location, content)
}

const initScript = (name, content=defaultInitScript) => {
    if(typeof content === 'function') content = content();
    fs.writeFileSync(name, content)
}

const gitignore = () => {
    fs.writeFileSync(path.join(dirName,'.gitignore'), gitignoreTemplate())
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