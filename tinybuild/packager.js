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
import { execSync, exec, spawn } from 'child_process';

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url';
import create from './create.js'

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
         
        if(parsed.electron) config.electron = parsed.electron;
        if(parsed.mobile) config.mobile = parsed.mobile;
        if(parsed.tauri) config.tauri = parsed.tauri;
        if(parsed.assets) config.assets = parsed.assets;

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

        let relpath = typeof config.electron === 'string' ? config.electron : './electron';
        
        if(!fs.existsSync(path.join(process.cwd(),relpath,'electron_app.js'))) {
            create.electronapp(path.join(process.cwd(),relpath)); //write boilerplate
        }

        const runElectronCLI = (retry=false) => {
            try {
                console.log("Copying contents for Electron build");
                let distpath = config.bundler.outdir;
                if(!distpath && config.bundler.outfile) {
                    let split = config.bundler.outfile.split('/');
                    split.pop();
                    let joined = split.join('/');
                    distpath = joined;
                } else throw new Error('no dist folder specified');

                const electrondir = path.join(process.cwd(),relpath);
                //let's just copy the source and any assets to a mobile dist folder we will sync with for simplicity
                fs.cpSync(path.join(process.cwd(),distpath),path.join(electrondir,distpath),{recursive:true});
                // if(fs.existsSync(path.join(process.cwd(),'index.html'))) //using a special electron boilerplate html, we could inject instead
                //     fs.copyFileSync(path.join(process.cwd(),'index.html'),path.join(electrondir,'index.html'));

                if(config.assets) {
                    config.assets.forEach((relpath) => {
                        const abspath = path.join(process.cwd(),relpath);
                        if(fs.existsSync(abspath)) {
                            if(fs.lstatSync(abspath).isDirectory() ) {
                                fs.cpSync(abspath, path.join(electrondir,relpath),{recursive:true});
                            } else {
                                fs.copyFileSync(abspath, path.join(electrondir,relpath));
                            }
                        }
                    });
                }

                exec(`npx electron ${relpath}`); //we'll use an electron subdirectory to separate the source code
            }
            catch(er) {
                if(retry) {
                    console.error(er);
                    return;
                }    
                
                // check for electron app directory, 
                if(!fs.existsSync(path.join(process.cwd(),relpath))) { 
                    fs.mkdirSync(path.join(process.cwd(),relpath));
                }

                console.log("Getting Electron Dependencies");
                execSync('npm i -D electron');

                runElectronCLI(true); //quit if fails again
            }
        }
        runElectronCLI();
    }

    //minimal desktop build, it's missing the latest chromium features!
    if(config.tauri) {

        const tauridir = path.join(process.cwd(),'src-tauri');
        const runTauriCLI = (retry=false) => {
            
            if(!fs.existsSync('tauri')) {
                create.tauriapp(process.cwd());
            }

            try {
                console.log("Copying contents for Tauri build");
                if(!fs.existsSync(path.join(process.cwd(),'src-tauri','tauri_dist'))) {
                    fs.mkdirSync(path.join(process.cwd(),'src-tauri','tauri_dist'));
                }

                let distpath = config.bundler.outdir;
                if(!distpath && config.bundler.outfile) {
                    let split = config.bundler.outfile.split('/');
                    split.pop();
                    let joined = split.join('/');
                    distpath = joined;
                } else throw new Error('no dist folder specified');

                //let's just copy the source and any assets to a mobile dist folder we will sync with for simplicity
                fs.cpSync(path.join(process.cwd(),distpath),path.join(tauridir,'tauri_dist',distpath),{recursive:true});
                if(fs.existsSync(path.join(process.cwd(),'index.html'))) //using a special electron boilerplate html, we could inject instead
                     fs.copyFileSync(path.join(process.cwd(),'index.html'),path.join(tauridir,'tauri_dist','index.html'));

                if(config.assets) {
                    config.assets.forEach((relpath) => {
                        const abspath = path.join(process.cwd(),relpath);
                        if(fs.existsSync(abspath)) {
                            if(fs.lstatSync(abspath).isDirectory() ) {
                                fs.cpSync(abspath, path.join(tauridir,'tauri_dist',relpath),{recursive:true});
                            } else {
                                fs.copyFileSync(abspath, path.join(tauridir,'tauri_dist',relpath));
                            }
                        }
                    });
                }



                console.log("Running Tauri")
                let prc = spawn('npx', ['tauri', 'build'], {
                    stdio: 'inherit',
                    shell:true
                }); 
            
                // Listen for any errors that occur
                prc.on('error', (error) => {
                    console.error(`Error: ${error.message}`);
                });
                
                // Handle the close event of the process
                prc.on('close', (code) => {
                    console.log(`Child process exited with code ${code}`);
                });

            }
            catch(er) {
                if(retry) {
                    console.error(er);
                    console.warn("You must have [Rust](https://www.rust-lang.org/tools/install) installed separately, and on Windows 7 or below [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)");
                    return;
                }

                console.log("Getting Tauri Dependencies");
                execSync('npm install -D @tauri-apps/cli');

                runTauriCLI(true);
            }
        }

        runTauriCLI();
    }
    
    //mobile build via capacitor
    if(config.mobile) { //See https://capacitorjs.com/docs/getting-started/environment-setup
        //const dir = typeof import.meta !== 'undefined' ? fileURLToPath(new URL('.', import.meta.url)) : globalThis.__dirname;
        //copy index.html to dist
        //create template if no relpath defined
        const mobiledir = path.join(process.cwd(),'mobile_dist');

        if(!fs.existsSync(mobiledir)) {
            fs.mkdirSync(mobiledir);
        }

        if(!fs.existsSync(path.join(process.cwd(),'capacitor.config.ts'))) {
            create.capacitor(process.cwd())
        }


        const runCapacitorCLI = (retry=false) => {
            try {
                
                //fyi you need to configure permissions in the android/ios projects too e.g. for bluetooth or gps access
                if(config.mobile.android && !fs.existsSync(path.join(process.cwd(),'android'))) {
                    console.log("Adding Android Boilerplate");
                    execSync('npx cap add android');
                }
                if(config.mobile.ios && !fs.existsSync(path.join(process.cwd(),'android'))) {
                    console.log("Adding IOS Boilerplate");
                    execSync('npx cap add ios');
                }

                console.log("Copying contents for Mobile build");
                //after bundling let's copy the index.html and dist folder to the mobile_dist folder
                let distpath = config.bundler.outdir;
                if(!distpath && config.bundler.outfile) {
                    let split = config.bundler.outfile.split('/');
                    split.pop();
                    let joined = split.join('/');
                    distpath = joined;
                } else throw new Error('no dist folder specified');

                //let's just copy the source and any assets to a mobile dist folder we will sync with for simplicity
                fs.cpSync(path.join(process.cwd(),distpath),path.join(mobiledir,distpath),{recursive:true});
                if(fs.existsSync(path.join(process.cwd(),'index.html'))) 
                    fs.copyFileSync(path.join(process.cwd(),'index.html'),path.join(mobiledir,'index.html'));

                if(config.assets) {
                    config.assets.forEach((relpath) => {
                        const abspath = path.join(process.cwd(),relpath);
                        if(fs.existsSync(abspath)) {
                            if(fs.lstatSync(abspath).isDirectory() ) {
                                fs.cpSync(abspath, path.join(mobiledir,relpath),{recursive:true});
                            } else {
                                fs.copyFileSync(abspath, path.join(mobiledir,relpath));
                            }
                        }
                    });
                }

                console.log("Syncing Mobile Build");
                execSync('npx cap sync'); //will sync the dist to the mobile apps

                if(config.mobile.android) {
                    console.log("Running Android Build Process");
                    if(config.mobile.android === 'open') 
                        exec('npx cap open android'); //will open Android Studio
                    else exec('npx cap run android'); //will open Android Studio
                }
                if(config.mobile.ios) {
                    console.log("Running IOS Build Process");
                    if(config.mobile.ios === 'open') 
                        exec('npx cap open ios'); //will open Android Studio
                    else exec('npx cap run ios'); //will open XCode
                }
            } catch(err) {
                if(retry) {
                    console.error(err);
                    console.warn("You need Android Studio for Android builds or XCode for IOS builds!")
                    return;
                }   

                console.log("Getting Capacitor Dependencies");
                execSync('npm i -D @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios');
                 //install android and ios dependencies (default, does not include Android Studio, XCode, or emulators)

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

