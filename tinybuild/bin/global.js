#!/usr/bin/env node
//^^^ allows node execution of this file as a node process, else 'tinybuild' will just cd to this file
import {execSync, fork} from 'child_process';
import * as fs from 'fs';
import path from 'path';

import {fileURLToPath} from 'url';

if(typeof import.meta !== 'undefined') {
    globalThis.__filename = fileURLToPath(import.meta.url);
    globalThis.__dirname = fileURLToPath(new URL('.', import.meta.url));
}

const thismodule = globalThis.__filename;



let dirName = thismodule.split(path.sep);
dirName.pop();
let globalpath = dirName.join(path.sep);

dirName.pop();
dirName.pop();

let mainpath = dirName.join(path.sep);

//console.log(globalpath,fs.existsSync(mainpath+'/node_modules'));

if(!fs.existsSync(path.join(mainpath,'node_modules'))) {
    console.log('🍏🐢 Installing node modules for tinybuild!');
    if(process.argv.includes('yarn'))  execSync(`cd ${mainpath} && yarn && cd ${process.cwd()}`); //install the node modules in the global repo
    else execSync(`cd ${mainpath} && npm i && cd ${process.cwd()}`); //install the node modules in the global repo
    console.log('Installed node modules for tinybuild! 🐢💚');
}

//console.log(process.argv);

// function exitHandler(options, exitCode) {

//     if (exitCode || exitCode === 0) console.log('EXIT CODE: ',exitCode);
//     if (options.exit) process.exit();
// }

// //do something when app is closing
// process.on('exit', exitHandler.bind(null,{cleanup:true}));

// //catches ctrl+c event
// process.on('SIGINT', exitHandler.bind(null, {exit:true}));
const temp = process.exit

let CHILDPROCESS = fork(path.join(mainpath,'tinybuild.js'), [...process.argv.splice(2), '--GLOBAL', globalpath], {cwd:process.cwd()});

// CHILDPROCESS.on('error',(er)=>{console.error(er);});
CHILDPROCESS.on('close',(er)=>{console.log("TINYBUILD EXIT CODE (close): ",er); process.exit()});
CHILDPROCESS.on('exit',(er)=>{console.log("TINYBUILD EXIT CODE (exit): ",er); process.exit()});
// CHILDPROCESS.on('crash',(er)=>{console.log('crash');});
// if(CHILDPROCESS.stderr) CHILDPROCESS.stderr.on('data',(er)=>{console.error(er);});
// if(CHILDPROCESS.stdout) CHILDPROCESS.stdout.on('data',(dat)=>{console.error(dat.toString());});

