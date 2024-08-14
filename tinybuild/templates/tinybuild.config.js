const config = {
    //build:true, //enable this to skip serve step (same as cli)
    //serve:true //or enable this to skip build step (same as cli)
    bundler: { //esbuild settings, set false to skip build step or add bundle:true to config object to only bundle (alt methods)
        entryPoints: [ //entry point file(s). These can include .js, .mjs, .ts, .jsx, .tsx, or other javascript files. Make sure your entry point is a ts file if you want to generate types
        "index.js"
        ],
        outfile: "dist/index", //exit point file, will append .js as well as indicators like .esm.js, .node.js for other build flags
        //outdir:'dist',         //exit point folder, define for multiple entryPoints

        //we can run multiple esbuild configs separately, set to true to target different outputs, we'll put it all in the dist in a way that keeps the files separate (e.g. index.js for the browser, index.esm.js for esm, index.node.js for node, or if only 1 bundler specified just index.js for any, it's the most general) when using multiple bundlers, additionally when specifying an outdir instead of outfile.
        bundleBrowser: true, //create plain js build? Can include globals and init scripts
        bundleESM: false, //create esm module js files 
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
        //  outputs:{ //overwrites main config settings for specific use cases, you can also just use objects instead of booleans on the above toggles for bundler modes
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
        //platform:'node'//etc 
        //loader:{ '.xml':'file', '.html':'text' } //etc etc, we supply a bunch of these for you you can copy typical files by default or import html text etc.
    },
    server: {  //node server settings, set false to skip server step or add serve:true to config object to only serve (alt methods)
        debug: false,
        protocol: "http",  //'http' or 'https'. HTTPS required for Nodejs <---> Python sockets. If using http, set production to False in python/server.py as well
        host: "localhost", //'localhost' or '127.0.0.1' etc.
        port: 8080, //e.g. port 80, 443, 8000
        //redirect: 'http://localhost:8082', //instead of serving the default content, redirect to another url
        //headers: { 'Content-Security-Policy': '*'  }, //global header overrides
        startpage: 'index.html',  //default home page/app entry point 
        hotreload: 5000,  //hotreload websocket server port
        socket_protocol: "ws", //frontend socket protocol, wss for served, ws for localhost
        /*
        routes:{ //set additional page routes (for sites instead of single page applications)
            '/page2': 'mypage.html',
            '/custom':{ //e.g. custom page template
                headers: { 'Content-Security-Policy': '*' }, //page specific headers 
                template:'<html><head></head><body><div>Hello World!</div></body></html>'
                //path: 'mypage.html' //or a file path (e.g. plus specific headers)
                //onrequest: (request,response) => {}, //custom request/response handling, return true to prevent any default response handling afterward
            },
            '/redirect':{ //e.g. custom redirect
                redirect:'https://google.com'
            },
            '/other':(request,response) => {}, //custom request/response handling, return true to prevent any default response handling afterward
            '/': 'index.html', //alt start page declaration
            '/404':'packager/node_server/other/404.html', //e.g. custom error page
        },
        */
        //reloadscripts: false, //hot swap scripts, can break things if script handles initializations, otherwise css, link, srcs all hot swap without page reloading fairly intelligently
        //delay: 50, //millisecond delay on the watch command for hot reloading
        //pwa: "service-worker.js",  //pwa mode? Injects service worker webpage code to live site, will create a service worker and webmanifest for you if not existent
        //watch: ['../'], //watch additional directories other than the current working directory
        //ignore:['./assets'], //ignore these paths
        //extensions:['pdf'], //custom file extensions to watch
        errpage: 'node_modules/tinybuild/tinybuild/node_server/other/404.html', //default error page, etc.
        certpath:'node_modules/tinybuild/tinybuild/node_server/ssl/server.crt',//if using https, this is required. See cert.pfx.md for instructions
        keypath:'node_modules/tinybuild/tinybuild/node_server/ssl/server.key'//if using https, this is required. See cert.pfx.md for instructions
        //python: false,//7000,  //quart server port (configured via the python server script file still)
        //python_node:7001, //websocket relay port (relays messages to client from nodejs that were sent to it by python)
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