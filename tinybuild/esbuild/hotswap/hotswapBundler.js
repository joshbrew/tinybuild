//we will run this script with runAndWatch

import esbuild from 'esbuild'
import fs from 'fs'
import { hotreloadPlugin } from "./hotreloadPlugin.js";
import path from 'path';
import { defaultBundler } from '../bundler.js';

//run tinybuild to build/serve project first time

//then watch for changes

///copy specific assets for rebundling outside the main context 
export async function hotBundle(
    bundlerConfig=defaultBundler, //imported from tinybuild
    changed=''
) {
    //then if a specified hotreload extension is altered (default for css) run the bundler without writing, use cache plugin

    console.time(`🔥 Hotswapped${changed ? ' ' + changed : ''} 🔥`);

    let outdir = bundlerConfig.outdir;
    if(!outdir) {
        if(bundlerConfig.outfile) {
            let split = bundlerConfig.outfile.split('/');
            split.pop();
            outdir = split.join('/');
        } else {
            let split = bundlerConfig.entryPoints[0].split('/');
            split.pop();
            if(split.length === 0) outdir = 'dist';
            else outdir = split.join('/');
        }
    }
    let outfile = bundlerConfig.outfile;
    if(!outfile) {
        outfile = bundlerConfig.entryPoints[0];
    }

    outfile = outfile.split('/').pop();

    let bundlerLookup = bundlerConfig.outfile;
    if(!bundlerConfig.outfile.startsWith('./')) bundlerLookup = './' + bundlerLookup;

    //let loader = {};
    // hotreloadExtensions.forEach((ext) => {
    //     if(!ext.startsWith('.')) ext = '.' + ext;
    //     loader[ext] = 'empty';
    // });

    // //get the list from the app. SLOW, use main bundle process to generate list
    // await esbuild.build({
    //     entryPoints:bundlerConfig.entryPoints,
    //     outdir,
    //     bundle:true,
    //     write:false,
    //     plugins:[hotreloadPlugin(extensions)],
    //     loader
    // });

    //console.log('css linked to bare js file');

    //after copying the css over we need to bundle the cached file

    let result = 'node_modules/.temp/'+outfile;
    if(!result.endsWith('.js')) result += '.js';

    await esbuild.build({
        entryPoints:['node_modules/.temp/index.js'],
        outfile:result,
        bundle:true,
        allowOverwrite:true,
        plugins:bundlerConfig.plugins ? bundlerConfig.plugins : [], //e.g. apply esbuild sass plugin
        loader:bundlerConfig.loader ? bundlerConfig.loader : {} //for future use, e.g. hotswapping html or assets
    });


    let cssresult = result.split('/').join(path.sep).replace(new RegExp('js' + '$'), 'css');
    if( //copy new css back over if css as it will bundle in its own file
        fs.existsSync(cssresult)
    ) {
        let cssfile = outfile;
        if(outfile.endsWith('js')) cssfile = outfile.replace(new RegExp('js' + '$'), 'css');
        else cssfile += '.css';
        fs.renameSync(
            cssresult, 
            path.join(outdir,cssfile)
        );
        //now the hotreload should trigger for css
    }

    //todo: any more rules we want?


    // fs.rmSync(result);
    // try { fs.rmdirSync('node_modules/.temp/'); } catch(er) {console.error(er);}

    console.timeEnd(`🔥 Hotswapped${changed ? ' ' + changed : ''} 🔥`);
    
}

