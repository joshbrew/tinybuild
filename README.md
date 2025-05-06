<p align="center">
  <img width="65%" height="65%" src="./catgnome.png" />
</p>

# tinybuild
[![npm version](https://img.shields.io/npm/v/tinybuild.svg)](https://www.npmjs.com/package/tinybuild)
[![npm downloads](https://img.shields.io/npm/dt/tinybuild.svg)](https://www.npmjs.com/package/tinybuild)
![license](https://img.shields.io/npm/l/tinybuild)

<table align="center">
  <tr>
    <td><img width="100" src="./img/esbuild.svg" alt="esbuild"></td>
    <td><img width="100" src="./img/nodejs.png" alt="Node.js"></td>
    <td><img width="100" src="./img/http.png"   alt="http dev‑server"></td>
    <td><img width="100" src="./img/desktop.png" alt="Desktop (Electron/Tauri)"></td>
    <td><img width="100" src="./img/smartphone.png" alt="Mobile (Capacitor)"></td>
  </tr>
</table>


> **One‑stop HTML5 / JavaScript web, server, desktop & mobile build tool — with zero cognitive rent.**

Install globally:

```bash
npm i -g tinybuild
```

…or as a local dev‑dependency:

```bash
npm i -D tinybuild
```

---


## Core Features

* **Minimal esbuild wrapper** – Typescript, JSX/TSX, CSS imports, code‑splitting. Build large apps in milliseconds. Deliver minimal compilations for fast web, mobile, and desktop builds.
* **Custom plugins** – Web‑worker bundling, streaming imports, automatic type‑generation, CSS hot‑swap.
* **Pure Node.js dev‑server** – Hot‑module reload via WebSockets; only one runtime dep (`chokidar`).
* **Multi‑target outputs** – Browser, ESM, Node, CommonJS, IIFE, `.d.ts` in the same run.
* **Native packaging** – Electron, Tauri, Capacitor flags copy your build into desktop/mobile shells.
* **Remote import helper** – Import from `https://` URLs or missing npm deps and Tinybuild grabs them for you.
* **Optional Python Quart bridge** – Full‑stack hot‑reload for async Python back‑ends.

> *“Goodbye esoteric instructions, goodbye unwieldy dependencies, goodbye staring at your compiler.”*


---

### Why roll our own?

> *Because javascript's tooling treadmill eats more time and headspace than the solutions it's meant to help you build faster and cheaper.*

The dev community’s mood has shifted: we’re done re‑learning a new package manager every quarter that nobody understands anyway, swimming through 30‑page migration guides, and praying that today’s “must‑have” plugin still compiles tomorrow. The zeitgeist favours **boringly fast, single‑purpose tools** that stay out of the way, skipping the third party esoteric formats to get straight to testing production-ready, native cross-platform javascript compilations.

| Decision axis                   | **Tinybuild (minimalist 2025 stack)**                                      | Vite / Webpack / Bun (ecosystem treadmill)                            |
| ------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| *First build experience*        | `tinybuild` → scaffold + serve in < 2 s.                                   | `npm create vite@latest`, pick template, install deps, tweak config.  |
| *Cognitive overhead*            | One plain JS config; flags are real nouns (`bundleBrowser`, `bundleNode`). | Custom DSL, nested Rollup, plugin labyrinth, breaking changes yearly. |
| *Plugin longevity*              | Four in‑tree plugins you can read in one sitting. Add any esbuild plugins. | Thousands of 3rd‑party plugins; many unmaintained within 12 mo.       |
| *Cross‑target output*           | Native flags `--electron`, `--tauri`, `mobile={}`.                         | Separate plugins & boilerplates (`vite-electron-builder`, etc.).      |
| *Remote imports & auto‑install* | Built‑in fetch + `npm install` on‑the‑fly.                                 | Rare / experimental add‑ons.                                          |
| *AI / automation readiness*     | Deterministic CLI, zero prompts, scriptable `packager()`.                  | Interactive scaffolds, variable outputs, harder to automate.          |

**Tinybuild exists because speed isn’t the only KPI; predictability and mental calm matter just as much.** Owning a 300‑line esbuild wrapper grants permanent immunity from tooling churn so we can spend that reclaimed time shipping features.

---

---

## Quickstart

```bash
# 1. Global install (or use npx tinybuild)
npm i -g tinybuild

# 2. In a clean folder
tinybuild           # scaffolds + bundles + starts dev‑server
```

Prerequisite: **Node.js LTS**.

When you run you should see something like: 

![img](https://github.com/joshbrew/tinybuild/blob/master/tinybuild/docs/globalOutp.PNG?raw=true)

These are typical benchmarks even on 10 year old laptops.

### Local (per‑project) install

```bash
npm i -D tinybuild
npx tinybuild       # or node tinybuild.js if you import { packager }
```

---

## Adding to an Existing Project

1. `npm init -y` (if needed)
2. `npm i -D tinybuild`
3. Generate config: `tinybuild init` or paste template below.
4. Run `npx tinybuild`.

<details>
<summary>Minimal config template ▼</summary>

```js
const config = {
  bundler: {
    entryPoints: ["index.js"],
    outfile: "dist/index",
    bundleBrowser: true,
    bundleESM: false,
    bundleTypes: false,
    bundleNode: false,
    bundleHTML: false,
    minify: true,
  },
  server: { //development server for testing distributions in a boilerplate html environment
    protocol: "http",
    host: "localhost",
    port: 8080,
    hotreload: 5000,
    startpage: "index.html",
  },
  // electron:true,
  // tauri:true,
  // mobile:{ android:'open', ios:false },
};
export default config;
```

</details>

See below for full instructions!

---

## CLI Cheatsheet

| Command                      | Description                                            |
| ---------------------------- | ------------------------------------------------------ |
| `tinybuild`                  | Build **and** serve (default)                          |
| `tinybuild build`            | Bundle only                                            |
| `tinybuild serve`            | Dev‑server only (no build)                             |
| `tinybuild help`             | List CLI/config commands.                              |
| `--config='{…}'`             | Inline JSON config override                            |

Everything is also exposed programmatically via:

```js
import { packager } from 'tinybuild';
packager(myConfig);
```

See below for full instructions!

---

## Deep‑Dive Docs

* **Quickstart** – [`docs/tinybuild.md`](tinybuild/docs/tinybuild.md)
* **esbuild Details** – [`docs/esbuild.md`](tinybuild/docs/esbuild.md)
* **Node Server** – [`docs/server.md`](tinybuild/docs/server.md)
* **Python Bridge** – [`docs/python.md`](tinybuild/docs/python.md)

---

## Troubleshooting

* **macOS shebang fix**

  ```bash
  brew install dos2unix
  sudo dos2unix $(npm root -g)/tinybuild/tinybuild/bin/global.js
  ```
* **Windows global perms** – search the npm error and apply usual ACL / build‑tools fixes.

---

## Contributing

We use Tinybuild daily; main may break occasionally. PRs, issues & feature ideas are welcome, especially **plugins** and **native‑target enhancements**.

---

## Full Configuration Reference

## For Existing Projects

In a project folder with a package.json (e.g. after running `npm init` for the first time), 

Create a `tinybuild.config.js` file like so (copy/paste or tinybuild can generate one for you by simply running):
```js
//import {defaultBundler, defaultServer, packager} from 'tinybuild'

const config = {
    //build:true, //enable this to skip serve step (same as cli)
    //serve:true //or enable this to skip build step (same as cli)
    bundler: { //esbuild settings, set false to skip build step or add bundle:true to config object to only bundle (alt methods)
        entryPoints: [ //entry point file(s). These can include .js, .mjs, .ts, .jsx, .tsx, or other javascript files. Make sure your entry point is a ts file if you want to generate types
        "index.js"
        ],
        outfile: "dist/index", //exit point file, will append .js as well as indicators like .esm.js, .node.js for other build flags
        //outdir:'dist'               //exit point folder, define for multiple entryPoints
        bundleBrowser: true, //create plain js build? Can include globals and init scripts
        bundleESM: false, //create esm module js files // { platform:'node' } //etc you can also supply an object here to add more specific esbuild settings
        bundleTypes: false, //create .d.ts files, //you need a .tsconfig for this to work, tinybuild will create one for you when you set this true, however, and has typescript support built in
        bundleNode: false, //create node platform plain js build, specify platform:'node' to do the rest of the files 
        bundleHTML: false, //wrap the first entry point file as a plain js script in a boilerplate html file, frontend scripts can be run standalone like a .exe! Server serves this as start page if set to true.
        //bundleIIFE:false,   //create an iife build, this is compiled temporarily to create the types files and only saved with bundleIIFE:true
        //bundleCommonJS:false, //cjs format outputted as .cjs
        minify: true,
        sourcemap: false,
        //plugins:[] //custom esbuild plugins? e.g. esbuild-sass-plugin for scss support
        //includeDefaultPlugins:true //true by default, includes the presets for the streaming imports, worker bundling, and auto npm install
        //blobWorkers:true, //package workers as blobs or files? blobs are faster but inflate the main package size
        //workerBundler:{minifyWhitespace:true} //bundler settings specific to the worker. e.g. apply platform:'node' when bundling node workers, default is minifyWhitespace:true as full minifying may cause unforeseen errors 
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
                headers: { 'Content-Security-Policy': '*' }, //page specific headers 
                template:'<html><head></head><body><div>Hello World!</div></body></html>'
                //path: 'mypage.html' //or a file path (e.g. plus specific headers)
            },
            '/redirect':{ //e.g. custom redirect
                redirect:'https://google.com'
            },
            '/other':(request,response) => {}, //custom request/response handling
            '/': 'index.html', //alt start page declaration
            '/404':'packager/node_server/other/404.html', //e.g. custom error page
        },
        */
        socket_protocol: "ws", //frontend socket protocol, wss for served, ws for localhost
        hotreload: 5000,  //hotreload websocket server port
        //reloadscripts: false, //hot swap scripts, can break things if script handles initializations, otherwise css, link, srcs all hot swap without page reloading fairly intelligently
        //delay: 50, //millisecond delay on the watch command for hot reloading
        //pwa: "service-worker.js",  //pwa mode? Injects service worker webpage code to live site, will create a service worker and webmanifest for you if not existent
        //watch: ['../'], //watch additional directories other than the current working directory
        //python: false,//7000,  //quart server port (configured via the python server script file still)
        //python_node:7001, //websocket relay port (relays messages to client from nodejs that were sent to it by python)
        errpage: 'node_modules/tinybuild/tinybuild/node_server/other/404.html', //default error page, etc.
        certpath:'node_modules/tinybuild/tinybuild/node_server/ssl/cert.pem',//if using https, this is required. See cert.pfx.md for instructions
        keypath:'node_modules/tinybuild/tinybuild/node_server/ssl/key.pem'//if using https, this is required. See cert.pfx.md for instructions
    },
    // electron:true //desktop apps as a full chromium bundle, not small and needs some customization for things like bluetooth menus. Better for full featured applications. Can trigger backend runtimes on local machines.
    /*mobile:{ //this will copy the dist and index.html to capacitor builds that can create small interoperable javascript webview + native functionality (e.g. bluetooth) mobile apps (~2Mb at minimum). 
        //android:'open', //'open'//true //Requires Android Studio, it will be launched
        //ios:false //'open'//true //Requires XCode 
    }, */
    //tauri:true, //alternative tauri build options for very minimal native engine desktop apps that generally lack the latest web APIs. Good for simple apps, you can bundle it with backend runtimes on local machines.
    /*
    assets:[ //for the mobile/desktop bundlers to copy into their respective folders
        './assets',
        './favicon.ico'
    ]
    */
}

export default config;
```

Please note the bundler object simply uses the base esbuild commands plus some extras that we filter out. We preset certain things like the file import formats so you easily import html and so on as text files or url refs or other as appropriate, then your specifications will override our defaults otherwise, which you can see if you go to tinybuild/esbuild and explore the files 

## tinybuild CLI commands:

e.g. `tinybuild build` or `tinybuild serve` to run isolated commands 

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



