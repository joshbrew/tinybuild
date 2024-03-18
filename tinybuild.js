//tinybuid.js


export * from './tinybuild/packager.js'
import path from 'path'

//uncomment and run `node tinybuild.js`
import {packager, serve} from './tinybuild/packager.js'
import * as commandUtil from './tinybuild/commands/command.js'
import {parseArgs} from './tinybuild/commands/command.js'
import { checkBoilerPlate, checkCoreExists, checkNodeModules, runAndWatch, runOnChange } from './tinybuild/repo.js'

// let config = {
//     bundler:{
//         entryPoints: ['test.js'], //entry file, relative to this file 
//         outfile: 'dist/built', //exit file
//         ////outdir:'dist'         //exit point folder, define for multiple entryPoints 
//         bundleBrowser: true, //plain js format
//         bundleESM: false, //.esm format
//         bundleTypes: false, //entry point should be a ts or jsx (or other typescript) file
//         bundleHTML: true //can wrap the built outfile (or first file in outdir) automatically and serve it or click and run the file without hosting.
//       },
//     server:defaultServer
// }

// //bundle and serve
// packager(config);


// /// or import and run initRepo, cd to that repo and run the tinybuild.js.




// TINYBUILD SCRIPTS

import * as fs from 'fs';
import {exec, execSync, spawn} from 'child_process';

//import nodemon from 'nodemon';

function exitHandler(options, exitCode) {

    //if (exitCode || exitCode === 0) console.log('tinybuild exit code: ',exitCode);
    if (options.exit) process.exit();
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));



//pass string argument array or pass a config object
export async function runTinybuild(args) {

    console.time('\n🚀   Starting tinybuild...');

    //console.log(args)
    let tinybuildCfg = {}
    let cmdargs = [];

    process.argv.forEach((v,i) => {
        if (v === 'bundle') process.argv[i] = 'build'; // Build is the default, bundle is an alias
    })

    if(Array.isArray(args)) {
        cmdargs = args;
        tinybuildCfg = parseArgs(args);
    } //to pass to the restart scripts
    else if (typeof args === 'object') {
        tinybuildCfg = args;
        cmdargs = process.argv;
        let dupResults = (str) => {
            if(tinybuildCfg.server?.[str]) {
                if(Array.isArray(tinybuildCfg.server[str])) tinybuildCfg.server[str] = tinybuildCfg.server[str].join(',');

                let cmdarg, argidx;
                for(let i = 0; i<cmdargs.length; i++) {
                    if(cmdargs[i].includes(str)) {
                        cmdarg = cmdargs[i].split('=')[1];
                        if(cmdarg.includes('[')) cmdarg = JSON.parse(cmdarg);
                        if(Array.isArray(cmdarg)) cmdarg = cmdarg.join(',');
                        argidx = i;
                        break;
                    }
                }
                if(cmdarg) {
                    cmdargs[argidx] = str+'='+tinybuildCfg.server[str]+','+cmdarg;
                }
                else cmdargs.push(str+'='+tinybuildCfg.server[str]);
            }
        }
        dupResults('watch');
        dupResults('ignore');
        dupResults('extensions');
    }
    //check global module path for node_modules folder


    let BUILD_PROCESS;
    let SERVER_PROCESS;

    //let fileName = __filename.split('/'); fileName = fileName[fileName.length-1]; //try to account for command line position and if the commands are for the current file

    // Get CLI Arguments
    const cliArgs = parseArgs(process.argv)
    // let scriptsrc = path.join(process.cwd(), (cliArgs.path) ? cliArgs.path : 'tinybuild.js')
    // const hasScript= fs.existsSync(scriptsrc)

    const config = cliArgs.cfgPath ? path.join(cliArgs.cfgpath,...path.split(cliArgs)) : path.join(process.cwd(),'tinybuild.config.js');
    const script = path.join(process.cwd(),'tinybuild.js');
    const global = path.join(tinybuildCfg.GLOBAL,'global_packager.js');


    //todo: make this stuff smarter
    if(!tinybuildCfg.path && fs.existsSync(config) && !fs.existsSync(script))  tinybuildCfg.path = global;
    if(!tinybuildCfg.path && fs.existsSync(script)) tinybuildCfg.path = script;
    if(!tinybuildCfg.path && tinybuildCfg.GLOBAL) tinybuildCfg.path = global;
    if(!tinybuildCfg.path) tinybuildCfg.path = 'tinybuild.js';

    //scenarios:
    /*     
        "start": "npm run startdev",
        "build": "cd example && node tinybuild.js",
        "init": "node tinybuild/init.js",
        "concurrent": "concurrently \"npm run python\" \"npm run startdev\"",
        "dev": "npm run pip && npm i --save-dev concurrently && npm i --save-dev nodemon && npm run concurrent",
        "startdev": "nodemon --exec \"cd example && node tinybuild.js\" -e ejs,js,ts,jsx,tsx,css,html,jpg,png,scss,txt,csv",
        "python": "python tinybuild/python/server.py",
        "pip": "pip install quart && pip install websockets",
        "pwa": "npm i workbox-cli && workbox generateSW tinybuild/node_server/pwa/workbox-config.js && npm run build && npm start"
    */

    //e.g. typing 'parcel' with a global install will target your entry files and bundle/serve with the dev server.
    // 'tinybuild' should look for the necessary basic files (index.js, index.html, and package.json), if core=true it looks for the source folder
    //     if any not found create the missing ones
    //  if found run the default bundle and serve configurations as if running the default packager.
    //      if bundle/serve configs found in init (using URI encoded stringified objects) apply those settings
    //  if mode=python, copy and run the python server in the project repo (since its meant as a template) 
    //  if mode=library disable the server and generate the esm files (just a quick setting I thought of)
    //  otherwise can apply additional settings used in tinybuild/init.js

    // with the extra settings we can apply them to the packager config

    if(!fs.existsSync(path.join(process.cwd(),'node_modules','tinybuild'))) { 
        execSync('npm link tinybuild');
    }

    if(cliArgs.mode !== 'help') {
        if(tinybuildCfg.server?.hotreload) { //hotreloading active
            let WATCHFOLDERS;
            let OUTFILE;
            if(tinybuildCfg.bundler) {
                if(tinybuildCfg.bundler.outfile) {
                    OUTFILE = tinybuildCfg.bundler.outfile.split('/').pop();
                    if(path.extname(OUTFILE)) OUTFILE = OUTFILE.replace(path.extname(OUTFILE),'');
                    let split = tinybuildCfg.bundler.outfile.split('/');
                    split.pop();
                    let joined = split.join('/');
                    WATCHFOLDERS = [joined];
                } else if (tinybuildCfg.bundler.outdir) {
                    OUTFILE = tinybuildCfg.bundler.entryPoints[0];
                    if(path.extname(OUTFILE)) OUTFILE = OUTFILE.replace(path.extname(OUTFILE),'');
                    WATCHFOLDERS = [tinybuildCfg.bundler.outdir];
                }
            }
            tinybuildCfg.server.hotreloadwatch = WATCHFOLDERS;
            tinybuildCfg.server.hotreloadoutfile = OUTFILE; //this is for reloading css
        }

        if(tinybuildCfg.start) { //execute the tinybuild.js in the working directory instead of our straight packager.

            if(!cliArgs.path && (!fs.existsSync(path.join(process.cwd(),'package.json')) || !fs.existsSync(path.join(process.cwd(),tinybuildCfg.path)) ||  (tinybuildCfg.bundleTypes && !fs.existsSync(path.join(process.cwd(),'tsconfig.json'))))) {
                await checkBoilerPlate(tinybuildCfg);
            }

            exec('node '+ tinybuildCfg.path,(err,stdout,stderr) => {});

        }
        else if (cliArgs.mode === 'python') { //make sure your node_server config includes a python port otherwise it will serve the index.html and dist
            //check if python server.py folder exists, copy if not
            if(!cliArgs.path && (!fs.existsSync(path.join(process.cwd(),'package.json')) || !fs.existsSync(path.join(process.cwd(),tinybuildCfg.path)) || !fs.existsSync(path.join(process.cwd(),'tinybuild.js')) || (tinybuildCfg.bundleTypes && !fs.existsSync(path.join(process.cwd(),'tsconfig.json'))))) {
                checkCoreExists();
                await checkBoilerPlate(tinybuildCfg);
            }

            let distpath = 'dist/index';
            if(tinybuildCfg.bundler?.outfile && !tinybuildCfg.bundler.outfile.endsWith('js')) distpath = tinybuildCfg.bundler.outfile + '.js';
            else if (tinybuildCfg.bundler.entryPoints) {
                let entry = tinybuildCfg.bundler.entryPoints.split('.');
                entry.pop();
                entry.join('.');
                entry.split('/');
                entry = entry.pop();
                distpath = 'dist/'+entry;
            }

            spawn('python',['tinybuild/python/server.py']); //this can exit independently or the node server will send a kill signal

            if(!cliArgs.path && (!fs.existsSync(path.join(process.cwd(),'package.json')) || !fs.existsSync(path.join(process.cwd(),tinybuildCfg.path))))
                await checkBoilerPlate(tinybuildCfg)


            let server = tinybuildCfg.server;
            tinybuildCfg.server = false;
            BUILD_PROCESS = runAndWatch(tinybuildCfg.path, cmdargs, tinybuildCfg.server.ignore, tinybuildCfg.server.extensions, tinybuildCfg.server.delay); //runNodemon(tinybuildCfg.path);
            SERVER_PROCESS = serve(server, BUILD_PROCESS);

        }
        else if (cliArgs.mode === 'dev') { //run a local dev server copy
            //check if dev server folder exists, copy if not
        
            if(!cliArgs.path && (!fs.existsSync(path.join(process.cwd(),'package.json')) || !fs.existsSync(path.join(process.cwd(), tinybuildCfg.path)) || !fs.existsSync(path.join(process.cwd(),'tinybuild.js')) || (tinybuildCfg.bundleTypes && !fs.existsSync(path.join(process.cwd(),'tsconfig.json'))))) {
                checkCoreExists();
                checkNodeModules();
                await checkBoilerPlate(tinybuildCfg);
            }

            let server = tinybuildCfg.server;
            tinybuildCfg.server = false;
            BUILD_PROCESS = runAndWatch(tinybuildCfg.path, cmdargs, tinybuildCfg.server.ignore, tinybuildCfg.server.extensions, tinybuildCfg.server.delay); //runNodemon(tinybuildCfg.path);
            SERVER_PROCESS = serve(server, BUILD_PROCESS); //separate server
        }
        // else if (tinybuildCfg.build || cmdargs.includes('bundle')) {
        //     delete tinybuildCfg.serve; //don't use either arg to run both
        //     tinybuildCfg.server = null;
        //     runOnChange('node',[tinybuildCfg.path, `config=${(JSON.stringify(tinybuildCfg))}`, ...cmdargs])
        // }
        else if (tinybuildCfg.serve || cmdargs.includes('serve')) {
            delete tinybuildCfg.build; //don't use either arg to run both
            tinybuildCfg.bundler = null;

            let server = tinybuildCfg.server;
            tinybuildCfg.server = false;
            BUILD_PROCESS = runAndWatch(tinybuildCfg.path,  [`--cfgpath`, config, '--build',...cmdargs], tinybuildCfg.server.ignore, tinybuildCfg.server.extensions, tinybuildCfg.server.delay);
            SERVER_PROCESS = serve(server, BUILD_PROCESS); //separate server
        }
        else {

            if(!cliArgs.path && (!fs.existsSync(path.join(process.cwd(),'package.json')) || (!fs.existsSync(path.join(process.cwd(),'tinybuild.config.js')) && !fs.existsSync(path.join(process.cwd(),'tinybuild.js'))) || (tinybuildCfg.bundleTypes && !fs.existsSync(path.join(process.cwd(),'tsconfig.json')))))
                {
                    await checkBoilerPlate(tinybuildCfg); //install boilerplate if repo lacks package.json
                    tinybuildCfg.path = path.join(process.cwd(),'tinybuild.config.js');
                }
                //console.log('spawning!!', tinybuildCfg)
            
            if((tinybuildCfg.server && !tinybuildCfg.build && !cmdargs.includes('build')) || tinybuildCfg.path.includes('tinybuild.js')) { 

                let server = tinybuildCfg.server;
                tinybuildCfg.server = false;
                BUILD_PROCESS = runAndWatch(tinybuildCfg.path, [`--cfgpath`, config, '--build', ...cmdargs], tinybuildCfg.server.ignore, tinybuildCfg.server.extensions, tinybuildCfg.server.delay);
                SERVER_PROCESS = serve(server, BUILD_PROCESS); //separate server
            }
            else packager(tinybuildCfg); //else just run the bundler and quit

        }

    } 

    console.timeEnd('\n🚀   Starting tinybuild...');

    return {BUILD_PROCESS, SERVER_PROCESS};
}


const args = commandUtil.get(process.argv);
let cfgPath = args.path
if(!cfgPath) cfgPath = 'tinybuild.config.js';

if(args.GLOBAL) {
    if(fs.existsSync(path.join(process.cwd(),cfgPath))) {

        import('file:///'+process.cwd()+'/'+cfgPath).then((m) => {

            if(typeof m.default?.bundler !== 'undefined' || typeof m.default?.server !== 'undefined' ) {
                console.log('Config:',cfgPath)
                runTinybuild(Object.assign({GLOBAL:args.GLOBAL},m.default));
            } else {
                runTinybuild(process.argv);
            }
        })
    }   
    else runTinybuild(process.argv);
} else runTinybuild(process.argv);