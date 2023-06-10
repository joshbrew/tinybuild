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
                let outfile = path.join("dist", path.basename(args.path));
                try {
                    // bundle worker entry in a sub-process
                    //console.time('👷 Bundled worker!')
                    //console.log('onLoad',args,builder);
                    let splitpath = outfile.split('.');
                    if(splitpath[splitpath.length-1] === 'ts') splitpath[splitpath.length-1] = 'js';
                    else if (splitpath[splitpath.length-1] !== 'js') splitpath.push('js');
                    outfile = splitpath.join('.');

                    await build(Object.assign({
                        entryPoints: [args.path],//[path.join(process.cwd(),'.temp','workerwrapper.js')],
                        outfile,
                        bundle: true,
                    }, config.bundler ? config.bundler : {}));
    
                    console.log('👷 Bundled worker!', args)
            
                    // return the bundled path
    
                    let pkg = fs.readFileSync(
                        path.join(process.cwd(),'package.json')
                    ).toString();
                    
                    let split = pkg.split('\n');
                    
                    let name = split.find((ln) => {
                        if(ln.includes('"name"')) {
                            return true;
                        }
                    });
                    if(name) {
                        name = name.split(':')[1].split('"')[1];
                        //console.log(name);
                    }
   
                    //console.log(outfile);
                    if(config?.blobWorkers) {

                        return { //resolve the file as an object url
                            contents:`
                                const str = String(${JSON.stringify(fs.readFileSync(outfile).toString())})
                                let url = URL.createObjectURL(new globalThis.Blob([str],{type:"text/javascript"}));
                                export default url;
                            `
                        }
                    }
                    return {  //resolve the file as a url
                        contents: `
                        let url;
                        if(typeof process !== 'undefined') {
                            //node
                            url = path.join(process.cwd(),'node_modules','${name}','${outfile}');
                        }
                        else url = window.location.origin+'/node_modules/${name}/${outfile.split(path.sep).join('/')}'; 
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

