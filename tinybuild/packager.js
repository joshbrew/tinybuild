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


import path from 'path'

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
    let packaged = {}

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
    console.timeEnd('\n🎂   Packager finished!');

    if(((config.build || !config.server) && !(!config.bundler && !config.server)) && exitOnBundle) {
        process.exit();
    }

    return packaged;
}

