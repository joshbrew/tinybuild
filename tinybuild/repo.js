import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import {execSync, spawn} from 'child_process';
// import { defaultServer } from './node_server/server.js';
import { defaultConfig } from './packager.js';
import * as commandUtil from './command.js';
import * as commands from './commands/index.js';
import create from './create.js';
import { getTemplateSync } from './templates/get.js';


//https://stackoverflow.com/questions/13786160/copy-folder-recursively-in-node-js
export function copyFolderRecursiveSync( source, target ) {
    var files = [];

    // Check if folder needs to be created or integrated
    var targetFolder = path.join( target, path.basename( source ) );
    if ( !fs.existsSync( targetFolder ) ) {
        fs.mkdirSync( targetFolder );
    }

    // Copy
    if ( fs.lstatSync( source ).isDirectory() ) {
        files = fs.readdirSync( source );
        files.forEach( function ( file ) {
            var curSource = path.join( source, file );
            if ( fs.lstatSync( curSource ).isDirectory() ) {
                copyFolderRecursiveSync( curSource, targetFolder );
            } else {
                fs.copyFileSync( curSource, targetFolder );
            }
        } );
    }
}


/// todo: fix the live reload functions as there are issues on mac

//BUG, REQUIRES NODEMON 
export async function runNodemon(script) {
    let NODEMON_PROCESS;
    try{
        const nodemon = await import('nodemon').nodemon
        process.env.HOTRELOAD = true; //enables the hot reloading port
    
        console.log("nodemon watching for changes...");
        NODEMON_PROCESS = nodemon(`--ignore ${process.cwd()}/dist/ --ignore ${process.cwd()}/node_modules/ --ignore ${process.cwd()}/.temp/ --exec 'node ${script}' -e ejs,js,ts,jsx,tsx,css,html,jpg,png,scss,txt,csv`);
        NODEMON_PROCESS.on('restart',()=>{console.log('nodemon restarted')})
        NODEMON_PROCESS.on('start',()=>{console.log('nodemon started')})
        //NODEMON_PROCESS.on('exit',()=>{console.log('nodemon exited'); process.exit()})
        NODEMON_PROCESS.on('crash',()=>{console.log('nodemon CRASHED'); process.exit()})
        NODEMON_PROCESS.on('log',(msg)=>{console.log('nodemon: ', msg.message)});
        // // let process = spawn("nodemon", [`--exec \"node ${script}\"`, "-e ejs,js,ts,jsx,tsx,css,html,jpg,png,scss,txt,csv"]); //should just watch the directory and otherwise restart this script and run the packager here for even smaller footprint
        
        // console.log(NODEMON_PROCESS.config);
        if(NODEMON_PROCESS.stdout) NODEMON_PROCESS.stdout.on('data',(data)=>{
            console.log('nodemon: ',data.toString());
        });
    
        if(NODEMON_PROCESS.stderr) NODEMON_PROCESS.stderr.on('data',(data)=>{
            console.log('nodemon error: ',data.message.toString());
        });
    } catch {}
    
    return NODEMON_PROCESS;

}

//spawns a child process when a change is detected in the working repository, e.g. a one-shot bundler script
export function runOnChange(
    command, 
    args=process.argv,
    ignore=['dist','temp','package'], 
    extensions=['js','ts','css','html','jpg','png','txt','csv','xls']
) { 

    let argMap; 
    try {argMap = commandUtil.check(args) } catch {}

    let watchPaths = process.cwd();
       
    if(argMap && argMap.server?.watch) { //watch='../../otherlibraryfolder'
        watchPaths = argMap.server.watch
        if(watchPaths.includes('[')) watchPaths = JSON.parse(watchPaths).push(process.cwd());
        else {
            watchPaths = watchPaths.split(',');
            watchPaths = [process.cwd(),...watchPaths];
        }
    }

    if(argMap && argMap.server?.extensions) { //watchext='../../otherlibraryfolder'
        let extPaths = argMap.server.extensions
        if(extPaths.includes('[')) extensions = JSON.parse(extPaths).push(...extensions);
        else {
            extPaths = extPaths.split(',');
            extensions = [...extensions,...watchPaths];
        }
    }
    
    if(argMap && argMap.server?.ignore) { //watch='../../otherlibraryfolder'
        let ignorePaths = argMap.server.ignore
        if(ignorePaths.includes('[')) ignore = JSON.parse(ignorePaths).push(...ignore);
        else {
            ignorePaths = ignorePaths.split(',');
            ignore = [...ignore,...ignorePaths];
        }
    }


    const watcher = chokidar.watch(
        watchPaths,{
            ignored: /^(?:.*[\\\\\\/])?node_modules(?:[\\\\\\/].*)?|(?:.*[\\\\\\/])?.git(?:[\\\\\\/].*)?|(?:.*[\\\\\\/])?android(?:[\\\\\\/].*)?|(?:.*[\\\\\\/])?ios(?:[\\\\\\/].*)?$/, // ignore node_modules
            persistent: true,
            ignoreInitial:true,
            interval:100,
            binaryInterval:200
        }
    );

    watcher.on('change',(path,stats)=>{
        let skip = false;
        ignore.forEach((p) => {
            if(path.includes(p)) {
                skip = true;
            }
        });
        if(!skip) {
            let extension = path.split('.').pop();
            extensions.forEach((ex) => {
            if(extension.includes(ex)) {
                skip = false;
            }
            })
        }

        if(!skip) {
            console.log('change detected at', path,'\n...Restarting...');

            let newprocess = spawn(
                command, args, {
                cwd: process.cwd(),
                env: process.env,
                detached: true
            }); //spawn the new script
            let p = newprocess;
    
            if(p.stderr) {
                p.stderr.on('data',(dat) => {
                    console.error(dat.toString());
                });
    
                p.stderr.pipe(process.stderr);
            }
    
            if(p.stdout) {
    
                p.stdout.on('data',(dat) => {
                    console.log(dat.toString());
                });
            
                p.stdout.pipe(process.stdout);
            }
    
            p.on('message', (msg) => {
                console.log('message from server:', msg);
            });

            p.on('close', ()=>{
                console.log("Child process finished: ", command,...args)
            })
        }
        
    })
    
    console.log("Watching for changes...");

    return watcher;

}

//run a script and watch the directory for changes then restart the script
export function runAndWatch(
    script,
    args=process.argv,
    ignore=['dist','temp','package'], 
    extensions=['js','ts','css','html','jpg','png','txt','csv','xls'],
    restartDelay=50
) {    

    let watchPaths = process.cwd();

    let argMap; 
    try {argMap = commandUtil.check(args) } catch {}

    if(argMap && argMap.server?.watch) { //watch='../../otherlibraryfolder'
        watchPaths = argMap.server.watch
        if(watchPaths.includes('[')) watchPaths = JSON.parse(watchPaths).push(process.cwd());
        else {
            watchPaths = watchPaths.split(',');
            watchPaths = [process.cwd(),...watchPaths];
        }
    }

    if(argMap && argMap.server?.extensions) { //watchext='../../otherlibraryfolder'
        let extPaths = argMap.server.extensions
        if(extPaths.includes('[')) extensions = JSON.parse(extPaths).push(...extensions);
        else {
            extPaths = extPaths.split(',');
            extensions = [...extensions,...watchPaths];
        }
    }
    
    if(argMap && argMap.server?.ignore) { //watch='../../otherlibraryfolder'
        let ignorePaths = argMap.server.ignore
        if(ignorePaths.includes('[')) ignore = JSON.parse(ignorePaths).push(...ignore);
        else {
            ignorePaths = ignorePaths.split(',');
            ignore = [...ignore,...ignorePaths];
        }
    }

    const watcher = chokidar.watch(
        watchPaths,{
        ignored: /^(?:.*[\\\\\\/])?node_modules(?:[\\\\\\/].*)?|(?:.*[\\\\\\/])?.git(?:[\\\\\\/].*)?|(?:.*[\\\\\\/])?android(?:[\\\\\\/].*)?|(?:.*[\\\\\\/])?ios(?:[\\\\\\/].*)?$/, // ignore node_modules
        persistent: true,
        ignoreInitial:true,
        interval:100,
        binaryInterval:200
    });

    let SERVER_PROCESS = {process:spawn('node',[script,...args])}
    let p = SERVER_PROCESS.process;

    if(p.stderr) p.stderr.on('data',(dat) => {
        console.error(dat.toString());
        p.on('exit',(code,sig) => {
            if(typeof code === 'number') process.exit();
        });
    });

    if(p.stdout) p.stdout.on('data',(dat) => {
        console.log(dat.toString());
    });

    p.on('message', (msg) => {
        console.log('message from server:', msg.toString());
    });


    watcher.on('change',(path,stats)=>{
        let skip = false;
        ignore.forEach((p) => {
            if(path.includes(p)) {
                skip = true;
            }
        });
        if(!skip) {
            let extension = path.split('.').pop();
            extensions.forEach((ex) => {
                if(extension.includes(ex)) {
                    skip = false;
                }
            })
        }

        if(!skip) {

            console.log('change detected at', path,'\n...Restarting...');
            const onclose = (code,signal) => {
                let respawn = () => {
                    SERVER_PROCESS.process = spawn('node',[script,...args]);
                    p = SERVER_PROCESS.process;
    
                    if(p.stderr) p.stderr.on('data',(dat) => {
                        let er = dat.toString();
                        if(!p.killed && er.includes('build')) p.kill();
                        console.error(er);
                    });
        
                    if(p.stdout) p.stdout.on('data',(dat) => {
                        let str = dat.toString();
                        console.log(str);
                    })
        
                    p.on('message', (msg) => {
                        console.log('message from server:', msg);
                    })
                }
                if(restartDelay) {
                    setTimeout(()=>{
                        respawn();
                    },
                    restartDelay);
                }
                else respawn();
            }
            p.on('close', onclose);
        

            if(!p.killed) p.kill();
            else onclose();

        }
        
    })

    console.log("Watching for changes...");

    return SERVER_PROCESS;
}

export function checkNodeModules() {
            
    if(!fs.existsSync(path.join(process.cwd(), 'node_modules'))) {
        console.log('Installing node modules...')
        if(process.argv.includes('yarn')) execSync(`yarn`); //install the node modules in the global repo
        else execSync(`npm i`); //install the node modules in the global repo
        console.log('Installed node modules!')
    }
}

export async function checkTSConfig() {
    const location = path.join(process.cwd(),'tsconfig.json')
    if(!fs.existsSync(location)) create.tsconfig(location)
}


export function checkCoreExists() {
    if(!fs.existsSync(path.join(process.cwd(), 'tinybuild'))) {
        const nodeMods = path.join('node_modules', 'tinybuild','tinybuild');
        if(fs.existsSync(nodeMods)) {
            copyFolderRecursiveSync(nodeMods,'tinybuild');
        }
    }
}


export async function checkConfig(cfgpath = path.join(process.cwd(),'tinybuild.config.js')) {
    let cfgexists = fs.existsSync(cfgpath)

    // Create Configuration File
    if(cfgexists) return false;
    else {

        create.config(cfgpath)

        return true;
    }
}

//'tinybuild' will trigger this script otherwise if it exists
export async function checkBuildScript() {

    const tinybuildPath = path.join(process.cwd(), 'tinybuild.js')

    if(!fs.existsSync(tinybuildPath)) {
        create.tinybuild(tinybuildPath)
        return true;
    }
    return false;
}

// NOTE: At a minimum, boilerplate includes a (1) a script / config , (1) a package.json and (3) an index.html file.
// If these files exist, none of the others are created.
// IMPORTANT: Using the tinybuild.config.js file at process.cwd() OR a generated one.
export async function checkBoilerPlate(tinybuildCfg=defaultConfig,onlyConfig=true) {
    //const config = await ((onlyConfig) ? createConfig() : checkBuildScript()); //this is borderline unreadable, also the import thing doesnt work unless the package is type:module, this builds on es5 packages now

    //let config; 
    if(!onlyConfig) {
        checkBuildScript();
    }
    checkConfig();
    
    let packagePath = path.join(process.cwd(),'package.json')

    let htmlPath = process.cwd()+'/index.html'

    let entryFile = tinybuildCfg.entryPoints ? tinybuildCfg.entryPoints[0] : tinybuildCfg.entryFile ? tinybuildCfg.entryFile : 'index.js';

    let outfile = 'dist/index';
    if(tinybuildCfg.bundler?.outfile) {
        outfile = tinybuildCfg.bundler.outfile;
    } else if(tinybuildCfg.bundler?.outdir) {
        outfile = tinybuildCfg.bundler.outdir[0];
    }

    let needPackage = !fs.existsSync(packagePath);

    let needHTML = true;
    let needEntry = true;
    if(tinybuildCfg.server?.startpage) {
        htmlPath = tinybuildCfg.server.startpage;
    } 
    if(tinybuildCfg.server) {
        needHTML = !fs.existsSync(htmlPath);
    }
    if(tinybuildCfg.bundler?.entryPoints[0]) {
        entryFile = tinybuildCfg.bundler.entryPoints[0];
    } 

    needEntry = !fs.existsSync(path.join(process.cwd(),entryFile)) && !fs.existsSync(path.join(process.cwd(),entryFile.replace(path.extname(entryFile),'.ts')));
    let entryFilePath = path.join(process.cwd(), entryFile) // assign index by first entrypoint

    if(needPackage) {

        create.package(packagePath)

        //console.log("Installing node modules...");
        
        // if(process.argv.includes('yarn')) execSync('yarn')
        // else execSync('npm i');

        //console.log("Installed node modules!");
        
    }


    // Auto-assign distpath
    if(needHTML) { //the python server needs the index.html

        console.log('Creating html boilerplate.');

        fs.writeFileSync(htmlPath,`
<!DOCTYPE html>
<html>
    <head>
        <link rel="stylesheet" href="${path.relative(path.join(htmlPath,'../'), path.join(process.cwd(),outfile)).split(path.sep).join('/')}.css">
    </head>
    <body>  
        <script src="${path.relative(path.join(htmlPath,'../'), path.join(process.cwd(),outfile)).split(path.sep).join('/')}.js">
        </script>
    </body>
</html>
        `)
    }

    if(needEntry) {

        console.log('Creating entry file: ', entryFilePath)

        // Make index.js if it doesn't exist
        if (needEntry) create.entry(entryFilePath) 

        //add css boilerplate
        fs.writeFileSync(path.join(process.cwd(),entryFile.replace(path.extname(entryFile),'.css')), getTemplateSync('index.css'));
    }

    
    if(!fs.existsSync(path.join(process.cwd(),'.gitignore'))) {
        console.log('Creating .gitignore');
        create.gitignore(process.cwd());
    }

    if(tinybuildCfg.bundler?.bundleTypes && !fs.existsSync(path.join(process.cwd(),'tsconfig.json'))) {
        console.log('Creating tsconfig');
        create.tsconfig(path.join(process.cwd(),'tsconfig.json'), undefined, entryFile); 
    }
        

}

//TODO: Make this more intelligent

//initialize a project repo with a simplified packager set up for you.
// If you set includeCore to true then the new repo can be used as a template for creating more repos with standalone tinybuild files
export async function initRepo(
    dirName='example',    
    entryPoints=['index.js'], //your head js file
    initScript=undefined,
    config={
        bundler:{
            entryPoints:entryPoints,
            outfile: 'dist/'+entryPoints[0].slice(0,entryPoints.lastIndexOf('.')),
            bundleBrowser: true, //plain js format
            bundleESM: false, //.esm format
            bundleTypes: false, //entry point should be a ts or jsx (or other typescript) file
            bundleHTML: true //can wrap the built outfile (or first file in outdir) automatically and serve it or click and run the file without hosting.
        },
        server:server.defaultServer
    }, //can set the config here
    includeCore=true, //include the core bundler and node server files, not necessary if you are building libraries or quickly testing an app.js
    ) {

        console.log('INIT REPO')

    if(!fs.existsSync(dirName)) 
        fs.mkdirSync(dirName); //will be made in the folder calling the init script

    //console.log(dirName);

    if(!fs.existsSync(path.join(dirName, Array.isArray(entryPoints) ? entryPoints[0] : entryPoints)) && !fs.existsSync(path.join(dirName, 'index.js')) && !fs.existsSync(path.join(dirName, 'index.ts'))) 
        create.entry(path.join(dirName, Array.isArray(entryPoints) ? entryPoints[0] : entryPoints))

    //copy the bundler files
    const tinybuildPath = path.join(dirName, 'tinybuild.js')
    let packagePath = path.join(dirName, 'package.json')

    if(!includeCore){
        //tinybuild.js file using the npm package 
        create.tinybuild(tinybuildPath,
        `
//use command 'node tinybuild.js' to build and run after doing npm install!

import {packager, defaultServer, initRepo} from 'tinybuild'
let config = ${JSON.stringify(config)};

//bundle and serve
packager(config);
        `);


    }
    else { //tinybuild js using a copy of the source and other prepared build files
        config.bundler.bundleHTML = false; //we'll target the index.html file instead of building this one

        let outfile = config.bundler.outfile;
        if(config.bundler.outdir) outfile = outdir[0];

        //index.html file
        fs.writeFileSync(path.join(dirName,'/index.html'),
        `
<!DOCTYPE html>
<html>
    <head></head>
    <body>
        <script src='${outfile}.js'></script>
    </body>
</html>
        `);

        copyFolderRecursiveSync('tinybuild',tinybuildPath);

        if(!fs.existsSync(tinybuildPath)) create.tinybuild(tinybuildPath,`
//create an init script (see example)
//node init.js to run the packager function

export * from './tinybuild/packager.js'
import { packager, defaultServer } from './tinybuild/packager.js'

let config = ${JSON.stringify(config)};

//bundle and serve
packager(config);
        `);

    }

    if(!fs.existsSync(packagePath)) create.package(packagePath);
    if(!fs.existsSync(path.join(process.cwd(),'.gitignore'))) create.gitignore(process.cwd());

    if(config.bundleTypes && !fs.existsSync(path.join(process.cwd(),'tsconfig.json'))) 
        create.tsconfig(path.join(process.cwd(),'tsconfig.json')); 

}

export function parseArgs(args=process.argv) {
    
    let tcfg = {
        server:{},
        bundler:{}
    }

    try{
        commandUtil.check(args, (name, value) => {
            if (value === null ) return // ignore if null
            else if (name in commands.server) tcfg.server[name] = value
            else if (name in commands.bundler) tcfg.bundler[name] = value
            else tcfg[name] = value
        }, tcfg)
    } catch {}
  

    if(tcfg.server) if(Object.keys(tcfg.server).length === 0) delete tcfg.server;
    if(tcfg.bundler) if(Object.keys(tcfg.bundler).length === 0) delete tcfg.bundler; 

    return tcfg;
}