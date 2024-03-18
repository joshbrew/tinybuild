const help = () => {
                    console.log(
`
tinybuild commands:

global command:
- 'tinybuild' -- runs the boilerplate tinybuild bundler + server settings in the current working directory. It will create missing index.js, package.json (with auto npm/yarn install), and tinybuild.js, and serve with watched folders in the working directory (minus node_modules because it slows down) for hot reloading.

local command:
- 'node path/to/tinybuild.js' -- will use the current working directory as reference to run this packager config

tinybuild arguments (applies to packager or tinybuild commands):
- 'start' -- runs the equivalent of 'node tinybuild.js' in the current working directory.
- 'bundle' -- runs the esbuild bundler, can specify config with 'config={"bundler":{}}' via a jsonified (and URI-encoded if there are spaces) object
- 'serve' -- runs the node development server, can specify config with 'config={"server":{}}' via a jsonified object and (URI-encoded if there are spaces) object
- 'mode=python' -- runs the development server as well as python which also serves the dist from a separate port (7000 by default). 
- 'mode=dev' for the dev server mode (used by default if you just type 'tinybuild' on boilerplate)
- 'path=custom.js' -- target a custom equivalent tinybuild.js entry file (to run the packager or bundler/server)st' - host name for the server, localhost by default

esbuild arguments:
- 'entryPoints=index.js' -- set an entry point for your script, can also be a JSONified array of strings.
- 'outfile=dist/index' -- set the output directory and file name (minus the extension name)
- 'outdir=dist' -- alternatively use outdir when using multiple entry points
- 'bundleBrowser=true' -- produce a plain .js bundle that is browser-friendly, true by default. 
- 'bundleESM=false' -- produce an ESM module bundle, false by default, Will be identified by .esm.js
- 'bundleTypes=false' -- produce .d.ts files, false by default, entry point needs to by a typescript file but it will attempt to generate types for js files in the repo otherwise. The files are organized like your repo in the dist folder used. 
- 'bundleNode=false' -- create a separate bundle set to include node dependencies. Identified by .node.js
- 'bundleHTML=true' -- bundle an HTML boilerplate that wraps and executes the browser bundle as a quick test. If true the packager command will set this file as the startpage, otherwise you have an index.html you can customize and use that has the same base boilerplate. Find e.g. index.build.html in dist.
- 'external=['node-fetch']' -- mark externals in your repo, node-fetch is used in a lot of our work so it's there by default, the node bundle has its own excludes (see our esbuild options in readme)
- 'platform=browser' -- the non-node bundles use browser by default, set to node to have all bundles target the node platform. Externals must be set appropriately.
- 'globalThis=myCustomBundle' -- You can set any exports on your entry points on the bundleBrowser setting to be accessible as a global variable. Not set by default.
- 'globals={['index.js']:['myFunction']}' -- you can specify any additional functions, classes, variables etc. exported from your bundle to be installed as globals on the bundleBrowser setting.

Server arguments:
- 'host=localhost' -- set the hostname for the server, localhost by default. You can set it to your server url or IP address when serving. Generally use port 80 when serving.
- 'port=8080' - port for the server, 8080 by default
- 'protocol=http' - http or https? You need ssl cert and key to run https
- 'python=7000' - port for python server so the node server can send a kill signal, 7000 by default. Run the python server concurrently or use 'mode=python'
- 'hotreload=5000' - hotreload port for the node server, 5000 by default
- 'watch=../../path/to/other/src' OR 'watch=['path/to/src1','src2','.xml']' - watch extra folders and extensions
- 'extensions=xml,3ds' OR 'extensions=['xml','3ds']' watch specific extensions for changes
- 'ignore=../../path/to/other/src,path2/src2' OR 'ignore=['path/to/src1','../path2/src2']'- ignore files and folders
- 'startpage=index.html' - entry html page for the home '/' page, index.html by default
- 'certpath=tinybuild/node_server/ssl/cert.pem' - cert file for https 
- 'keypath=tinybuild/node_server/ssl/key.pem' - key file for https
- 'pwa=tinybuild/pwa/workbox-config.js' - service worker config for pwa using workbox-cli (installed separately via package.json), the server will install a manifest.json in the main folder if not found, https required
- 'config="{"server":{},"bundler":{}}"' -- pass a jsonified config object for the packager. See the bundler and server settings in the docs.
- 'init' -- initialize a folder as a new tinybuild repository with the necessary files, you can include the source using the below command
- 'core=true' -- include the tinybuild source in the new repository with an appropriate package.json
- 'entry=index.js' --name the entry point file you want to create, defaults to index.js
- 'script=console.log("Hello%20World!")' -- pass a jsonified and URI-encoded (for spaces etc.) javascript string, defaults to a console.log of Hello World!

Native Desktop and Mobile Apps:
- 'electron' -- Start an electron app with boilerplate, copying your dist and specified assets. See Electron Docs
- 'mobile={android:'open',ios:false}' -- Use Capacitor to create a bundled mobile app, use 'open' to run android studio or xcode, or set to true to use the CLI, assuming you have dependencies installed. See Capacitor Docs.
- 'tauri' -- Alternative minimal desktop runtime via Tauri. See Tauri Docs.
- 'assets=['./assets','favicon.ico']' -- Specify additional assets to copy to the native distributions

`
                    )
    process.exit();
}

export default help