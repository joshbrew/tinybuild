
tinybuild is the result of testing a ton of bundlers and development servers and landing on this combination of packages and settings. It is instantaneous (<100ms for bundling and serving, <3 seconds if you are bundling types for modules in mid-size libraries). 


Feature breakdown:

## [esbuild](./esbuild.md)
## [node server](./server.md)
## [python](./python.md)


esbuild supports the full spectrum of javascript bundling needs and we have documented its typical features fairly well with our settings. See their website for more information. 

The node server is no-frills with websocket based hot reloading and basic examples of python backend communication and relaying. It's small and fast and meets our most common development server needs without giant dependencies.

## Global install

`npm i -g tinybuild`

then from an empty project folder, initialize a default app with:

`tinybuild`

Or first create a tinybuild.config.js in your project directory like so:
```js
//import {defaultBundler, defaultServer, packager} from 'tinybuild'

let entryPoints = ['index.js']

const config = {
    //build:true, //enable this to skip serve step (same as cli)
    //serve:true //or enable this to skip build step (same as cli)
    bundler: { //esbuild settings, set false to skip build step or add bundle:true to config object to only bundle (alt methods)
        entryPoints: [ //entry point file(s). These can include .js, .mjs, .ts, .jsx, .tsx, or other javascript files. Make sure your entry point is a ts file if you want to generate types
        "index.js"
        ],
        outfile: "dist/index", //exit point file, will append .js as well as indicators like .esm.js, .node.js for other build flags
        //outdir:'dist'         //exit point folder, define for multiple entryPoints
        bundleBrowser: true, //create plain js build? Can include globals and init scripts
        bundleESM: false, //create esm module js files // { platform:'node' } //etc you can also supply an object here to add more specific esbuild settings
        bundleTypes: false, //create .d.ts files, //you need a .tsconfig for this to work
        bundleNode: false, //create node platform plain js build, specify platform:'node' to do the rest of the files 
        bundleHTML: false, //wrap the first entry point file as a plain js script in a boilerplate html file, frontend scripts can be run standalone like a .exe! Server serves this as start page if set to true.
        //bundleIIFE:false,   //create an iife build, this is compiled temporarily to create the types files and only saved with bundleIIFE:true
        //bundleCommonJS:false, //cjs format outputted as .cjs
        minify: true,
        sourcemap: false,
        //plugins:[] //custom esbuild plugins? e.g. esbuild-sass-plugin for scss support
        //includeDefaultPlugins:true //true by default, includes the presets for the streaming imports, worker bundling, and auto npm install
        //blobWorkers:true, //package workers as blobs or files? blobs are faster but inflate the main package size
        //workerBundler:{minifyWhitespace:true} //bundler settings specific to the worker. e.g. apply platform:'node' when bundling node workers, 
        //globalThis:null //'mymodule'
        //globals:{'index.js':['Graph']}
        //init:{'index.js':function(bundle) { console.log('prepackaged bundle script!', bundle); }.toString(); }      
        //  outputs:{ //overwrites main config settings for specific use cases
        //     node:{ //e.g. for bundleNode
        //     // external:[] //externals for node environment builds
        //     },
        //     //commonjs:{} //bundleCommonJS
        //     //browser:{}
        //     //esm:{}
        //     iife:{
        //     // external:[] //we only use the iife for types so it doesn't really matter if it bundles node, just note otherwise if you need iife for some obscure reason
        //     }
        // },
        
        //refer to esbuild docs for more settings
     },
    server: {  //node server settings, set false to skip server step or add serve:true to config object to only serve (alt methods)
        debug: false,
        protocol: "http",  //'http' or 'https'. HTTPS required for Nodejs <---> Python sockets. If using http, set production to False in python/server.py as well
        host: "localhost", //'localhost' or '127.0.0.1' etc.
        port: 8080, //e.g. port 80, 443, 8000
        //redirect: 'http://localhost:8082' //instead of serving the default content, redirect ot another url
        //headers: { 'Content-Security-Policy': '*'  }, //global header overrides
        startpage: 'index.html',  //default home page/app entry point 
        /*
            routes:{ //set additional page routes (for sites instead of single page applications)
                '/page2': 'mypage.html',
                '/custom':{ //e.g. custom page template
                    template:'<html><head></head><body><div>Hello World!</div></body></html>'
                },
                '/redirect':{ //e.g. custom redirect
                    redirect:'https://google.com'
                },
                '/other':(request,response) => {}, //custom request/response handling
                '/': 'index.html', //alt start page declaration
                '/404':'packager/node_server/other/404.html', //alt error page declaration
            },
        */
        socket_protocol: "ws", //frontend socket protocol, wss for served, ws for localhost
        hotreload: 5000,  //hotreload websocket server port
        //reloadscripts: false, //hot swap scripts, can break things if script handles initializations, otherwise css, link, srcs all hot swap without page reloading fairly intelligently
        //delay: 50, //millisecond delay on the watch command for hot reloading
        //pwa: "dist/service-worker.js",  //pwa mode? Injects service worker registry code in (see pwa README.md)
        //watch: ['../'], //watch additional directories other than the current working directory
        //python: false,//7000,  //quart server port (configured via the python server script file still)
        //python_node:7001, //websocket relay port (relays messages to client from nodejs that were sent to it by python)
        errpage: 'node_modules/tinybuild/tinybuild/node_server/other/404.html', //default error page, etc.
        certpath:'node_modules/tinybuild/tinybuild/node_server/ssl/cert.pem',//if using https, this is required. See cert.pfx.md for instructions
        keypath:'node_modules/tinybuild/tinybuild/node_server/ssl/key.pem'//if using https, this is required. See cert.pfx.md for instructions
    },
    /*
    mobile:{ //this will copy the dist and index.html to capacitor builds that can create small interoperable javascript webview + native functionality (e.g. bluetooth) mobile apps (~2Mb at minimum). 
        android:'open', //'open'//true //Requires Android Studio, it will be launched
        ios:false //'open'//true //Requires XCode 
    },
    electron:true, //desktop apps as a full chromium bundle, not small and needs some customization for things like bluetooth menus. Better for full featured applications. Can trigger backend runtimes on local machines.
    tauri:true, //alternative tauri build options for very minimal native engine desktop apps that generally lack the latest web APIs. Good for simple apps, you can bundle it with backend runtimes on local machines.
    assets:[ //for the mobile/desktop bundlers to copy into their respective folders
        './assets',
        './favicon.ico'
    ]
    */
}

export default config;
```

Then run `tinybuild`.

## Local node_modules/tinybuild Builds (no global package manager)
For using tinybuild locally (`npm install` vs `npm install -g`) you must import and run `packager(config)` from the tinybuild library yourself, and run it in a script file.

### Example:

Create tinybuild.js at the root of your project directory
```js
import {packager} from 'tinybuild'
import config from './tinybuild.config.js'

packager(config);

```

then in the console from that project directory run `node tinybuild.js`


## tinybuild commands:

`tinybuild help` lists accepted arguments, see the boilerplate created in the new repo for more. The `tinybuild` command will use your edited `tinybuild.config.js` or `tinybuild.js` (which includes the library and executes the packager with the bundler and/or server itself for more control) config file after initialization so you can use it generically, else see the created `package.json` for more local commands.

global command:
- `tinybuild` -- runs the boilerplate tinybuild bundler + server settings in the current working directory. It will create missing index.js, package.json (with auto npm/yarn install), and tinybuild.js, and serve with watched folders in the working directory (minus node_modules because it slows down) for hot reloading.

local command:
- `node path/to/tinybuild.js` -- will use the current working directory as reference to run this packager config

### tinybuild arguments (applies to packager or tinybuild commands):
- `start` -- runs the equivalent of `node tinybuild.js` in the current working directory.
- `build`/`bundle` -- runs the esbuild bundler, can specify config with `config={"bundler":{}}` via a jsonified object
- `serve` -- runs the node development server, can specify config with `config={"server":{}}` via a jsonified object and object
- `mode=python` -- runs the development server as well as python which also serves the dist from a separate port (7000 by default). 
- `mode=dev` for the dev server mode (used by default if you just type `tinybuild` on boilerplate)
- `path=custom.js` -- target a custom equivalent tinybuild.js entry file (to run the packager or bundler/server)st` - host name for the server, localhost by default

### esbuild arguments:
- `entryPoints=index.js` -- set an entry point for your script, can also be a JSONified array of strings.
- `outfile=dist/index` -- set the output directory and file name (minus the extension name)
- `outdir=dist` -- alternatively use outdir when using multiple entry points
- `bundleBrowser=true` -- produce a plain .js bundle that is browser-friendly, true by default. 
- `bundleESM=false` -- produce an ESM module bundle, false by default, Will be identified by .esm.js
- `bundleTypes=false` -- produce .d.ts files, false by default, entry point needs to by a typescript file but it will attempt to generate types for js files in the repo otherwise. The files are organized like your repo in the dist folder used. 
- `bundleNode=false` -- create a separate bundle set to include node dependencies. Identified by .node.js
- `bundleHTML=true` -- bundle an HTML boilerplate that wraps and executes the browser bundle as a quick test. If true the packager command will set this file as the startpage, otherwise you have an index.html you can customize and use that has the same base boilerplate. Find e.g. index.build.html in dist.
- `external=['node-fetch']` -- mark externals in your repo, node-fetch is used in a lot of our work so it's there by default, the node bundle has its own excludes (see our esbuild options in readme)
- `platform=browser` -- the non-node bundles use browser by default, set to node to have all bundles target the node platform. Externals must be set appropriately.
- `globalThis=myCustomBundle` -- You can set any exports on your entry points on the bundleBrowser setting to be accessible as a global variable. Not set by default.
- `globals={[entryPoint]:['myFunction']}` -- you can specify any additional functions, classes, variables etc. exported from your bundle to be installed as globals on the bundleBrowser setting.

### Server arguments:
- `host=localhost` -- set the hostname for the server, localhost by default. You can set it to your server url or IP address when serving. Generally use port 80 when serving.
- `port=8080` - port for the server, 8080 by default
- `protocol=http` - http or https? You need ssl cert and key to run https
- `python=7000` - port for python server so the node server can send a kill signal, 7000 by default. Run the python server concurrently or use `mode=python`
- `hotreload=5000` - hotreload port for the node server, 5000 by default
- `watch=../../path/to/other/src` OR `watch=['path/to/src1','src2','.xml']` - watch extra folders and extensions
- `extensions=xml,3ds` OR `extensions=['xml','3ds']` watch specific extensions for changes
- `ignore=../../path/to/other/src,path2/src2` OR `ignore=['path/to/src1','../path2/src2']`- ignore files and folders
- `startpage=index.html` - entry html page for the home '/' page, index.html by default
- `certpath=tinybuild/node_server/ssl/cert.pem` - cert file for https 
- `keypath=tinybuild/node_server/ssl/key.pem` - key file for https
- `pwa=tinybuild/pwa/workbox-config.js` - service worker config for pwa using workbox-cli (installed separately via package.json), the server will install a manifest.json in the main folder if not found, https required
- `config="{"server":{},"bundler":{}}"` -- pass a jsonified config object for the packager. See the bundler and server settings in the docs.
- `init` -- initialize a folder as a new tinybuild repository with the necessary files, you can include the source using the below command
- `core=true` -- include the tinybuild source in the new repository with an appropriate package.json
- `entry=index.js` --name the entry point file you want to create, defaults to index.js
- `script=console.log("Hello%20World!")` -- pass a jsonified and URI-encoded (for spaces etc.) javascript string, defaults to a console.log of Hello World!

### Native Desktop and Mobile Apps
- `electron` -- Start an electron app with boilerplate, copying your dist and specified assets. See Electron Docs
- `mobile={android:'open',ios:false}` -- Use Capacitor to create a bundled mobile app, use 'open' to run android studio or xcode, or set to true to use the CLI, assuming you have dependencies installed. See Capacitor Docs.
- `tauri` -- Alternative minimal desktop runtime via Tauri. See Tauri Docs.
- `assets=['./assets','favicon.ico']` -- Specify additional assets to copy to the native distributions



## init

A more detailed way to create an app is to use `initRepo` in `node tinybuild/init.js`, you can apply all of these settings through the main `tinybuild` command by passing the arguments in the help command. 

```js
defaultRepo = {
    dirName:`example',    
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
            bundleHTML: true
        },
        server:server.defaultServer
    }, //can set the config here
    includeCore:true, //include the core bundler and node server files, not necessary if you are building libraries or quickly testing an app.js
}
```

### Command line settings

You can customize default repo settings above via command line if you don't want to create your own init file to run `initRepo(dirName='example',entryPoints='index.js',initScript='some stringified script',config={...bundlerConfig},includeCore=boolean)`

Like so `node tinybuild/init.js dir=myApp core=true` to make a directory called myApp that includes the source code and a default package.json, app or library entry point .js file, and tinybuild.js bundle+serve file for you to customize following our documentation.

```js
// e.g. via command line: 'node tinybuild/init.js dir=myApp core=true'
    if(command.includes('dir')) {
        defaultRepo.dirName = command.split('=').pop()
    }
    if(command.includes('entry')) {
        defaultRepo.entryPoints = command.split('=').pop()
    }
    if(command.includes('core')) {
        defaultRepo.includeCore = command.split('=').pop()
    }
    if(command.includes('script')) {
        defaultRepo.initScript = decodeURIComponent(command.split('=').pop())
    }
    if(command.includes('config')) {
        defaultRepo.config = decodeURIComponent(command.split('=').pop())
    }
```


## tinybuild quick start:
Create a package.json if you don't have one. You an use these scripts to run the server.
```json

{
    "name": "tinybuildapp",
    "version": "0.0.0",
    "description": "Barebones esbuild and test node server implementation. For building",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "type":"module",
    "scripts": {
        "start": "tinybuild",
        "build": "tinybuild build",
        "serve": "tinybuild serve",
        "init": "node tinybuild/init.js",
        "concurrent": "concurrently \"npm run python\" \"npm start\"",
        "dev": "npm run pip && npm i --save-dev concurrently && npm i --save-dev nodemon && npm run concurrent",
        "startdev": "nodemon --exec \"node tinybuild.js\" -e ejs,js,ts,jsx,tsx,css,html,jpg,png,scss,txt,csv",
        "python": "python python/server.py",
        "pip": "pip install quart && pip install websockets",
        "pwa": "npm i workbox-cli && workbox generateSW node_server/pwa/workbox-config.js && npm run build && npm start",
        "electron": "electron ./electron",
        "android": "npx cap open android",
        "ios":"npx cap open ios",
        "tauri": "tauri"
    },
    "keywords": [
        "esbuild"
    ],
    "author": "",
    "license": "",
    "dependencies": {
    },
    "devDependencies": {
    },
    "nodemonConfig": {
        "env": {
            "NODEMON": true
        },
        "ignore": [
            "dist/",
            ".temp/"
        ]
    }
}

```


Then `npm i` or copy source folder into your project. We recommend the above settings to run the development server for hot reloading and concurrent python support.

Create a javascript app entry point
```js


    document.body.style.backgroundColor = '#101010'; //page color
    document.body.style.color = 'white'; //text color
    let div = document.createElement('div');
    div.innerHTML = 'Hello World!';
    document.body.appendChild(div);
    
    alert('tinybuild successful!');

```

Create a tinybuild.js script in your main folder:
```js

    //use command 'node tinybuild.js' to build and run after doing npm install!

    import {packager, defaultServer, initRepo} from 'tinybuild'
    let config = {
        bundler:{
            entryPoints: ['app.js'],
            outfile: 'dist/app',
            bundleBrowser: true, //plain js format
            bundleESM: false, //.esm format
            bundleTypes: false, //entry point should be a ts or jsx (or other typescript) file
            bundleHTML: true
        },
        server:defaultServer
    }
    
    //bundle and serve
    packager(config);

```

Then run `node tinybuild.js`

The function 
```js
packager(config)
``` 
simply combines the [bundle()] and [serve()] functions and settings objects to run sequentially using a combined object labeled as above. We provide `defaultBundler` and `defaultServer` for quick setup (or `defaultConfig` for combined). 

