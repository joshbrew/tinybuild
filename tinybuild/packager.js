export * from './esbuild/bundler.js'
export * from './esbuild/streamingImportsPlugin.js'
export * from './esbuild/workerPlugin.js'
export * from './esbuild/installerPlugin.js'
export * from './esbuild/hotswap/hotreloadPlugin.js'
export * from './esbuild/hotswap/hotswapBundler.js'
export * from './node_server/server.js'
export * from './repo.js'

import * as bundler from './esbuild/bundler.js'
import { hotreloadPlugin } from './esbuild/hotswap/hotreloadPlugin.js'
import { hotBundle } from './esbuild/hotswap/hotswapBundler.js'
import * as server from './node_server/server.js'
import { parseArgs } from './commands/command.js'
import { execSync } from 'child_process';

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url';

export const defaultConfig = {
    bundler: Object.assign({},bundler.defaultBundler),
    server: Object.assign({},server.defaultServer)
}

export async function packager(config=defaultConfig, exitOnBundle=true) {
    console.time('\n🎂   Packager finished!');
    // console.log(config);

    let parsed;
    if(process?.argv) { //add any command line arguments
        parsed = parseArgs(process.argv);

        if(parsed.cfgpath) {
            let settingsModule = await import('file:///'+parsed.cfgpath);
            if(settingsModule.default) Object.assign(parsed, settingsModule.default);
        }
        // console.log('args: ', process.argv);
        // console.log('parsed args: ', parsed);
        
        if(parsed.bundler) 
            Object.assign(config.bundler,parsed.bundler);
        else if ('bundler' in parsed) {
            config.bundler = parsed.bundler;
            if(!parsed.server) delete config.server;
        }
        
        if(parsed.server) 
            Object.assign(config.server,parsed.server);
        else if ('server' in parsed) {
            config.server = parsed.server;
            if(!parsed.bundler) delete parsed.bundler;
        }
         
        if(parsed.serve) config.serve = true;
        if(parsed.build) config.build = true;
    }
    let packaged = {};

    if(config.build && parsed.changed && config.server?.hotreloadExtensions.find((e) => {
        if(e.replace('.','') === path.extname(parsed.changed).replace('.','')) return true; //check extensions for hotreload rules
    })) { //run for us by the hotreload and runAndWatch logic
        //run the hotbundler
        await hotBundle(
            config.bundler, 
            parsed.changed
        );
    }
    else if(config.bundler && !config.serve || (!config.bundler && !config.server && !config.serve)) {

        if(config.server?.hotreload) { //install the hotreload plugin if hotreload server specified
            if(!config.bundler.plugins?.find((p) => {if(p.name === 'hotreloadcacher') return true;})); {
                let plugin = hotreloadPlugin(config.server?.hotreloadExtensions ? config.server?.hotreloadExtensions : defaultConfig.server.hotreloadExtensions);
                config.bundler.plugins ? config.bundler.plugins.push(plugin) : config.bundler.plugins = [plugin];
            }
        }

        packaged.bundles = await bundler.bundle(config.bundler);

        if(config.bundler?.bundleHTML) { //serve the bundled app page 
            
            let outfile = config.bundler.outfile;
            if(!outfile && config.bundler.outdir) outfile = config.bundler.outdir + '/' + config.bundler.entryPoints[0];
            if(!outfile) outfile = 'dist/index' //defaults

            let path = outfile+'.html';

            console.log('Default HTML app bundled: ', path);
                        
            if(config.server) config.server.startpage = path;
        }
    }
    if(((config.server && !config.build) || (!config.bundler && !config.server))) { //now serve the default server. Global will serve from tinybuild.js script to enable hot swapping with a runAndWatch on this script
        packaged.server = await server.serve(config.server);
    }

    //chromium desktop build
    if(config.electron) {
        const runElectronCLI = (retry=false) => {
            try {

                //check for electron app directory, 
                // create with electron app boilerplate to import the dist from our main project 
                //  and wrap in electron boilerplate

                execSync('npx electron ./electron'); //we'll use an electron subdirectory to separate the source code
            }
            catch(er) {
                if(retry) {
                    console.error(er);
                    return;
                }    
                
                //we need to create a boilerplate electron app file to execute via nodejs which will become our executable entry point

                runElectronCLI(true);
            }
        }
        runElectronCLI();
    }

    //minimal desktop build, it's missing the latest chromium features!
    if(config.tauri) {
        const runTauriCLI = (retry=false) => {
            try {
                execSync('npm run tauri init'); //assuming our package.json has "tauri":"tauri" in scripts (let's check and add if not)
            }
            catch(er) {
                execSync('npm install --save-dev @tauri-apps/cli');
            }
        }
    }
    
    //mobile build via capacitor
    if(config.mobile) { //See https://capacitorjs.com/docs/getting-started/environment-setup
        const dir = typeof import.meta !== 'undefined' ? fileURLToPath(new URL('.', import.meta.url)) : globalThis.__dirname;
        //copy index.html to dist
        //create template if no relpath defined
        if(!fs.existsSync(config.mobile.config)) {
            fs.copyFileSync(path.join(dir,'templates','capacitor.config.ts'), cfg); //copy the index.html
        }

        let outdir;
        if(config.bundler.outfile) {
            let split = config.bundler.outfile.split('/');
            if(!split[0] || split[0] === '.') outdir = split[1];
            else outdir = split[0];
        } else config.bundler.outdir ||'./dist';
        
        if(!fs.existsSync(path.join(process.cwd(),'index.html'))) {
            fs.copyFileSync(path.join(dir,'templates/index.html'),path.join(outdir,'index.html')); //copy the index.html
        } else fs.copyFileSync(path.join(process.cwd(),'index.html'),path.join(outdir,'index.html')); //copy the index.html

        const runCapacitorCLI = (retry=false) => {
            try {
                execSync('npx cap sync'); //will sync the dist to the mobile apps

                if(config.mobile.android) {
                    if(config.mobile.android === 'open') 
                        execSync('npx cap open android'); //will open Android Studio
                    else execSync('npx cap run android'); //will open Android Studio
                }
                if(config.mobile.ios) {
                    if(config.mobile.ios === 'open') 
                        execSync('npx cap open ios'); //will open Android Studio
                    else execSync('npx cap run ios'); //will open XCode
                }
            } catch(err) {
                if(retry) {
                    console.error(err);
                    return;
                }   

                execSync('npm i @capacitor/core');
                execSync('npm i -D @capacitor/cli');
                execSync('npm i @capacitor/android @capacitor/ios'); //install android and ios dependencies (default, does not include Android Studio, XCode, or emulators)
                execSync('npx cap init'); //this will init the capacitor projects

                //fyi you need to configure permissions in the android/ios projects too e.g. for bluetooth or gps access
                if(config.mobile.android) execSync('npx cap add android');
                if(config.mobile.ios) execSync('npx cap add ios');
                
                runCapacitorCLI(true); //if it fails again, quit
            }
        }

        runCapacitorCLI();
    }

    console.timeEnd('\n🎂   Packager finished!');

    if(((config.build || !config.server) && !(!config.bundler && !config.server)) && exitOnBundle) {
        process.exit();
    }

    return packaged;
}

