
const config = {
    bundler: { //esbuild settings, set false to skip build step or add bundle:true to config object to only bundle (alt methods)
        entryPoints: [ //entry point file(s). These can include .js, .mjs, .ts, .jsx, .tsx, or other javascript files. Make sure your entry point is a ts file if you want to generate types
        "src/app.js"
        ],
        outfile: "dist/app", //exit point file, will append .js as well as indicators like .esm.js, .node.js for other build flags
        //outdir:'dist'         //exit point folder, define for multiple entryPoints
        bundleBrowser: true, //create plain js build? Can include globals and init scripts
        bundleESM: false, //create esm module js files
        bundleTypes: false, //create .d.ts files, the entry point must be a typescript file! (ts, tsx, etc)
        bundleNode: false, //create node platform plain js build, specify platform:'node' to do the rest of the files 
        bundleHTML: true, //wrap the first entry point file as a plain js script in a boilerplate html file, frontend scripts can be run standalone like a .exe! Server serves this as start page if set to true.
        minify:false
    },
    server: {  //node server settings, set false to skip server step or add serve:true to config object to only serve (alt methods)
        debug: false,
        protocol: "http",  //'http' or 'https'. HTTPS required for Nodejs <---> Python sockets. If using http, set production to False in python/server.py as well
        host: "localhost", //'localhost' or '127.0.0.1' etc.
        port: 8080, //e.g. port 80, 443, 8000
        startpage: "src/index.html", //home page
        socket_protocol: "ws", //frontend socket protocol, wss for served, ws for localhost
        hotreload: 5000,  //hotreload websocket server port
        pwa: "dist/service-worker.js",  //pwa mode? Injects service worker registry code in (see pwa README.md)
        python: 7000,//false  //quart server port (configured via the python server script file still)
        python_node: 7001, //websocket relay port (relays messages to client from nodejs that were sent to it by python)
        errpage: "src/other/404.html",  //default error page, etc.
        certpath: "packager/node_server/ssl/cert.pem", //if using https, this is required. See cert.pfx.md for instructions
        keypath: "packager/node_server/ssl/key.pem" //if using https, this is required. See cert.pfx.md for instructions
    }
}

module.exports = config; //export default config; //es6