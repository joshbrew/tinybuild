//hack to get workers to bundle correctly

import path from 'path';
import fs from 'fs';
import pkg from 'esbuild';
const { build } = pkg;

export const workerPlugin = (
    config={
        blobWorkers:true,  //if false you get a url to a relative file path, if true you get a compiled dataurl that can be loaded with new Worker(url) in either situation. The blob workers are nice for easier distribution
        bundler:{ minifyWhitespace:true } //apply any desired esbuild settings
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
                            ln = ln.replaceAll("'",'"'); //exception case
                            ln = ln.replaceAll("`",'"');
                            let spl = ln.split(':')[1].split('"')[1].trim().split('//')[0].replace(',','');
                            let nm = spl;
                            nm = nm.split('/'); nm.pop();
                            if(nm[0] === '.') nm.shift();
                            outdir = nm.join('/'); //left with folder name
                            return true;
                        } else if (ln.includes('outdir')) {
                            ln = ln.replaceAll("'",'"');
                            ln = ln.replaceAll("`",'"');
                            let spl = ln.split(':')[1].split('"')[1].trim().split('//')[0].replace(',','');
                            outdir = spl;
                            return true;
                        }
                    });

                    let buildSettings = {
                        entryPoints: [args.path],//[path.join(process.cwd(),'.temp','workerwrapper.js')],
                        outdir,
                        bundle: true,
                    };
                    

                    if(config?.blobWorkers) {
                        buildSettings.write = false;
                    } 

                    let filename = args.path.split(path.sep);
                    filename = filename[filename.length-1];

                    let ext = path.extname(filename);
                    filename = filename.replace(ext,'.js');

                    let outfile = outdir + '/' + filename;
                    console.log('\n🔨 Bundling Worker...');
                    console.time ('\n👷 Bundled worker: ' + filename);
                    let bundle = await build(Object.assign(buildSettings, config.bundler));

                    console.timeEnd('\n👷 Bundled worker: ' + filename);//, args)
                    if(!config?.blobWorkers) {
                        console.log("Output: ", outfile);
                    }
            
                    // return the bundled path


                    //console.log(outfile);
                    if(config?.blobWorkers && bundle.outputFiles[0]) { //&& bundle.outputFiles[0])

                        let workerJs = bundle.outputFiles[0].text;


                        if(buildSettings.format !== 'esm') {
                            function insertTextIntoString(inputString, textToInsert, sequenceToFind) {
                                // Find the last occurrence of the sequence to find
                                const endIndex = inputString.lastIndexOf(sequenceToFind);
                            
                                if (endIndex === -1) {
                                    console.error('The target sequence was not found in the string.');
                                    return inputString;
                                }
                            
                                // Insert the text before the target sequence
                                const modifiedString = inputString.slice(0, endIndex) + textToInsert + inputString.slice(endIndex);
                            
                                return modifiedString;
                            }

                            workerJs = insertTextIntoString(bundle.outputFiles[0].text, `;if(typeof import_meta !== 'undefined')import_meta.url=location.origin+"/${outdir}/";`, `})()`);
                        }

                        return { //resolve the file as an object url for running new Worker(blob)
                            contents:`
                                const str = String(${JSON.stringify(workerJs)})
                                let url = URL.createObjectURL(new globalThis.Blob([str],{type:"text/javascript"}));
                                export default url;
                            `//bundle.outputFiles[0].text.toString()
                        }
                    }

                    //hack to fix the import_meta.url being blank (helps with third party wasm imports when using import.meta.url in the source since non esm bundles will put in a placeholder)
                    if(buildSettings.format !== 'esm') {
                            
                        function insertTextIntoFile(filePath, textToInsert, callback) {
                            const sequenceToFind = '})();\n';

                            fs.open(filePath, 'r+', (err, fd) => {
                                if (err) {
                                    console.error('Error opening file:', err);
                                    return;
                                }

                                fs.fstat(fd, (err, stats) => {
                                    if (err) {
                                        console.error('Error getting file stats:', err);
                                        fs.close(fd, () => {});
                                        return;
                                    }

                                    const fileSize = stats.size;
                                    const bufferSize = sequenceToFind.length;
                                    const buffer = Buffer.alloc(bufferSize);

                                    // Read the last part of the file to find the sequence
                                    fs.read(fd, buffer, 0, bufferSize, fileSize - bufferSize, (err, bytesRead, buffer) => {
                                        if (err) {
                                            console.error('Error reading file:', err);
                                            fs.close(fd, () => {});
                                            return;
                                        }

                                        const bufferString = buffer.toString('utf8');
                                        if (bufferString !== sequenceToFind) {
                                            console.error('The target sequence was not found at the end of the file.');
                                            fs.close(fd, () => {});
                                            return;
                                        }

                                        // Calculate the position to insert the text
                                        const insertionPosition = fileSize - bufferSize;

                                        // Read the part of the file that will be shifted
                                        const remainingBuffer = Buffer.alloc(bufferSize);
                                        fs.read(fd, remainingBuffer, 0, bufferSize, insertionPosition, (err, bytesRead, remainingBuffer) => {
                                            if (err) {
                                                console.error('Error reading remaining part of the file:', err);
                                                fs.close(fd, () => {});
                                                return;
                                            }

                                            // Move the file pointer back to the insertion position
                                            fs.write(fd, Buffer.from(textToInsert), 0, textToInsert.length, insertionPosition, (err) => {
                                                if (err) {
                                                    console.error('Error writing to file:', err);
                                                    fs.close(fd, () => {});
                                                    return;
                                                }

                                                // Write the remaining part back to the file
                                                fs.write(fd, remainingBuffer, 0, bufferSize, insertionPosition + textToInsert.length, (err) => {
                                                    if (err) {
                                                        console.error('Error writing the remaining part back to file:', err);
                                                    } else {
                                                        //console.log('Text inserted successfully.');
                                                    }
                                                    fs.close(fd, callback);
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        }

                        insertTextIntoFile(outfile, `;if(typeof import_meta !== 'undefined')import_meta.url=location.origin+"/${outdir}/";`);
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
                                url = p.join(process.cwd(),__dirname,'${outdir}','${filename}');
                            } catch {}
                        }
                        else {
                            let href = globalThis.location.href;
                            let relLoc = href.split('/');
                            relLoc.pop();
                            relLoc = relLoc.join('/');
                            url = relLoc + '/${outdir}/${filename}'; //this is the served url
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

