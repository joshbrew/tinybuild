//node tinybuild/init.js

import { get } from "./command";
import { initRepo } from "./repo";

let defaultRepo = {
    dirName:'example',    
    entryPoints:'index.js', //your head js file
    initScript:`
/* 
    esbuild + nodejs (with asyncio python) development/production server. 
    Begin your javascript application here. This file serves as a simplified entry point to your app, 
    all other scripts you want to build can stem from here if you don't want to define more entryPoints 
    and an outdir in the bundler settings.
*/

document.body.style.backgroundColor = '#101010'; //page color
document.body.style.color = 'white'; //text color
let div = document.createElement('div');
div.innerHTML = 'Hello World!';
document.body.appendChild(div);

alert('tinybuild successful!');
    `,
    config:{
        bundler:{
            entryPoints: [this.entryPoints],
            outfile: 'dist/'+this.entryPoints.slice(0,this.entryPoints.lastIndexOf('.')),
            bundleBrowser: true, //plain js format
            bundleESM: false, //.esm format
            bundleTypes: false, //entry point should be a ts or jsx (or other typescript) file
            bundleHTML: true  //wrap the first entry point file as a plain js script in a boilerplate html file, frontend scripts can be run standalone like a .exe!
        },
        server:server.defaultServer
    }, //can set the config here
    includeCore:true, //include the core bundler and node server files, not necessary if you are building libraries or quickly testing an app.js
}

//wtf??
const commandMap = get(process.argv)

        if(commandMap.dir) {
            defaultRepo.dirName = commandMap.dir
        }
        if(commandMap.entry) {
            defaultRepo.entryPoints = commandMap.entry
        }
        if(commandMap.core) {
            defaultRepo.includeCore = commandMap.core
        }
        if(commandMap.script) {
            defaultRepo.initScript = decodeURIComponent(commandMap.script)
        }
        if(commandMap.config) {
            defaultRepo.config = JSON.parse(decodeURIComponent(commandMap.config))
        }

initRepo(
    defaultRepo.dirName,    
    defaultRepo.entryPoints, //your head js file
    defaultRepo.initScript,
    defaultRepo.config, //can set the config here
    defaultRepo.includeCore, //include the core bundler and node server files, not necessary if you are building libraries or quickly testing an app.js
)
