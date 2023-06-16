//hack to get workers to bundle correctly

import path from 'path';
import fs from 'fs';
import pkg from 'esbuild';
const { build } = pkg;

export const workerPlugin = (
    config={
        blobWorkers:true,  //if false you get a url to a relative file path, if true you get a compiled dataurl that can be loaded with new Worker(url) in either situation. The blob workers are nice for easier distribution
        bundler:{minifyWhitespace:true} //apply any desired esbuild settings
    }) => {
    return { //modified from https://github.com/evanw/esbuild/issues/312#issuecomment-698649833
        name:'workerloader',
        setup(builder) {
            builder.onResolve({ filter: /\b[w|W]orker\.[m|c]?[j|t]s/ }, (args) => {
                if(args.kind.includes('import') || args.kind.includes('require')){
                    return { path: path.join(args.resolveDir,args.path)};
                }
            });
    
            builder.onLoad({ filter: /\b[w|W]orker\.[m|c]?[j|t]s/ },
            async (args) => {
                try {
                    // bundle worker entry in a sub-process
                    //console.log('onLoad',args,builder);
                        
                    let buildconfig = fs.readFileSync(
                        path.join(process.cwd(),'tinybuild.config.js')
                    ).toString();
                    
                    let split = buildconfig.split('\n');
                    
                    let outdir;

                    split.find((ln) => {
                        if(ln.includes('outfile')) {
                            let spl = ln.split(':')[1].split('//')[0].replace(',','');
                            let nm = JSON.parse(spl);
                            nm = nm.split('/'); nm.pop();
                            if(nm[0] === '.') nm.shift();
                            outdir = nm.join('/'); //left with folder name
                            return true;
                        } else if (ln.includes('outdir')) {
                            let spl = ln.split(':')[1].split('//')[0].replace(',','');
                            console.log(spl)
                            outdir = JSON.parse(ln.split(':')[1].replace(',',''));
                            return true;
                        }
                    });

                    let buildSettings = {
                        entryPoints: [args.path],//[path.join(process.cwd(),'.temp','workerwrapper.js')],
                        outdir,
                        bundle: true,
                    };

                    if(config) config.blobWorkers = false;

                    if(config?.blobWorkers) {
                        buildSettings.write = false;
                    } 

                    let filename = args.path.split(path.sep);
                    filename = filename[filename.length-1];

                    let ext = path.extname(filename);
                    filename = filename.replace(ext,'.js');

                    let outfile = outdir + '/' + filename;

                    let bundle = await build(Object.assign(buildSettings, config.bundler ? config.bundler : {}));

                    console.log('👷 Bundled worker!');//, args)
                    if(!config?.blobWorkers) {
                        console.log("Output: ", outfile);
                    }
            
                    // return the bundled path


                    //console.log(outfile);
                    if(config?.blobWorkers && bundle.outputFiles[0]) { //&& bundle.outputFiles[0])

                        return { //resolve the file as an object url for running new Worker(blob)
                            contents:`
                                const str = String(${JSON.stringify(bundle.outputFiles[0].text)})
                                let url = URL.createObjectURL(new globalThis.Blob([str],{type:"text/javascript"}));
                                export default url;
                            `//bundle.outputFiles[0].text.toString()
                        }
                    }
                    return {  //resolve the file contents as a url for running new Worker(url)
                        contents: `
                        let url;
                        if(typeof process !== 'undefined') { //nodejs
                            try { //this executes in esbuild for some reason so this will prevent bundle error
                                if(typeof import.meta !== 'undefined') {
                                    globalThis.__filename = fileURLToPath(import.meta.url);
                                    globalThis.__dirname = fileURLToPath(new URL('.', import.meta.url));
                                }
                                let p = require('path');
                                url = p.join(process.cwd(),__dirname,'${filename}');
                            } catch {}
                        }
                        else {
                            let href = globalThis.location.href;
                            let relLoc = href.split('/');
                            relLoc.pop();
                            relLoc = relLoc.join('/');
                            url = relLoc + '/${filename}'; //this is the served url
                        }
                        export default url;
                    ` };
                } catch (e) {
                    // ...
                    console.error("Error bundling worker:", e);
                }
            });
        }
    }

}

