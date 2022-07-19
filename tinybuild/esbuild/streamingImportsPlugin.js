

import fs from 'fs'
import path from 'path';

const re = /import([ \n\t]*(?:\* (?:as .*))?(?:[^ \n\t\{\}]+[ \n\t]*,?)?(?:[ \n\t]*\{(?:[ \n\t]*[^ \n\t"'\{\}]+[ \n\t]*,?)+\})?[ \n\t]*)from[ \n\t]*(['"])([^'"\n]+)(?:['"])([ \n\t]*assert[ \n\t]*{type:[ \n\t]*(['"])([^'"\n]+)(?:['"])})?/g 

const handleImport = async (pathStr, tryFileExtension=true) => {
  const pathArr = pathStr.split('/')
  const pathSlice = pathArr.splice(2)
  const pathAddition = ['node_modules','.cache', ...pathSlice]
  const pathDir = path.dirname(path.join(...pathSlice)).split('/')
  const dir = path.dirname(path.join(...pathAddition)).split('/')
  const filename = path.basename(pathStr) ?? 'index.js'
  let cachepath = path.join(process.cwd(), ...dir, filename);

  if(!path.extname(cachepath)){ 
    cachepath += '.js'; //should account for other file types like css if they can be imported without extensions
  }
  //if(!cachepath.endsWith('.js') < 0) cachepath += '.js';
  //request http/s resource
  //write file to cache
  //resolve new path to local cache for bundler to target 

  if(!fs.existsSync(cachepath)) {
    const pathAccum = []
    dir.forEach(str => {
      pathAccum.push(str)
      const thisPath = path.join(process.cwd(), ...pathAccum)
      if(!fs.existsSync(thisPath)) fs.mkdirSync(thisPath);
    })

    const pathPrefix = pathArr[0]+ '//'
    const fetchPath = pathPrefix + path.join(...pathSlice)

    console.time('esbuild cached streamed http(s) import at ' + cachepath);
    let text = await httpGet(fetchPath).then(async buffer => {
      const text =  await buffer.toString('utf-8')
      if (!text.includes("Couldn't find the requested file")) {
        return text
      } else {
        const fileExtensionPath = pathPrefix + path.join(...pathDir, filename, 'index.js')
        if (tryFileExtension) {
        const {cachename, text} = await handleImport( fileExtensionPath, false)
      } else console.error('Could not find file', fileExtensionPath)

        return 
      }
    })
    
    if (text) {
     text = await text.toString('utf-8')

    // Get Internal Imports
    let m;
    do {
        m = re.exec(text)
        if (m == null) m = re.exec(text); // be extra sure (weird bug)
        if (m) {
            text = text.replace(m[0], ``) // Replace found text
            const importPath = m[3]
            const updatedPath = pathPrefix + path.join(...pathDir, importPath)
            await handleImport(updatedPath)
        }
    } while (m);

    fs.writeFileSync(cachepath, text); //cache cdn imports etc.
  
  //we should handle skypack stuff too which has nested import/exports from urls (this is a snowpack provided site to turn cdn links into esm bundles)
  // let split = text.split('\n'); 
  // split.forEach((ln,i) => {
  //   if(ln.includes('export ') || ln.includes('import ')) {
  //     ln[i] = 
  //   }
  // })
  // console.log(text.split('\n'));
    console.timeEnd('esbuild cached streamed http(s) import at ' + cachepath);
  }
  }

  return {
    cachepath,
  }
}

export const streamingImportsPlugin = {
  name:'streamImports',
  setup(build) {
    // Handle all import/require paths starting with "http://" or "https://"
    build.onResolve({ filter: /^https?:\/\// }, async (args) => {

      if(args.kind?.includes('import') || args.kind?.includes('require')) {
        const {cachepath} = await handleImport(args.path)

        return { path:path.join(cachepath) }
      }
    });
  }
}

import http from 'http';
import https from 'https';
import { cwd } from 'process';
//custom plugin to resolve http imports
export function httpGet(url) {
  return new Promise((resolve, reject) => {

    let client = http;

    if (url.toString().indexOf("https") === 0) {
      client = https;
    }

    client.get(url, (resp) => {
      let chunks = [];

      // A chunk of data has been recieved.
      resp.on('data', (chunk) => {
        chunks.push(chunk);
      });

      // The whole response has been received. Print out the result.
      resp.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

    }).on("error", (err) => {
      reject(err);
    });
  });
}
