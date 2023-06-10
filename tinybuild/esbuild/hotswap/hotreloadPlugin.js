//hack to get workers to bundle correctly

import path from 'path';
import fs from 'fs';

let dirPath = path.join(process.cwd(),'node_modules','.temp');

//this simply copies desired file formats to a cache which will enable recompiling only specific parts of the program
export function hotreloadPlugin(
    extnames = ['css','sass','less','scss']
) {

    let filter = new RegExp(`\.(${extnames.join('|').replaceAll('.','')})$`);
    let files = [];

    let cwd = process.cwd();
    cwd = cwd.split(path.sep).join('/');
    
    return {
        name:'hotreloadcacher',
        setup(builder) {
            builder.onResolve({ filter }, async (args) => {
                if((args.kind.includes('import') || args.kind.includes('require')) && !args.importer.includes('node_modules')){
                    
                    if(!fs.existsSync(dirPath)) {
                        fs.mkdirSync(dirPath);
                    }

                    //make sure the copied files get unique names e.g. for redundantly named styles.css type stuff in big web component libraries
                    //note: we can't do anything about scoped style tags as esbuild compiles it all into one file
                    let fname = path.basename(args.path);
                    if(files.includes(fname)) {
                        let ctr = 1;
                        while(files.includes(fname)) {
                            fname = path.basename(args.path) + ctr;
                            ctr++;
                        }
                    }
                    files.push(cwd+'/'+args.path);

                    //fs.copyFileSync(args.path, path.join(process.cwd(),'node_modules','.cache',fname));
                    
                }
            });
    
            // builder.onLoad({ filter: /.*/},
            //     async (args) => {
            //     });
            // }

            builder.onStart(() => {
                files = [];
            });

            builder.onEnd(() => {
                let indexFile = ``;

                files.forEach((f) => {
                    indexFile += `import '${f}' \n`; //import
                });

                //write an index file that imports all of the files for esbuild to resolve this in a separate build
                if(fs.existsSync(dirPath)) 
                    fs.writeFileSync(path.join(process.cwd(),'node_modules','.temp','index.js'), indexFile); 
            });

            //build.onDispose(() => {})
        }
    }
    
}



