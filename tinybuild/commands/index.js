
import { json, exists } from "./utils.js"


import help from "./basic/help.js"

export const basic = {
    'start': undefined,
    'build': undefined,
    'serve': {not: ['server']},
    'init': undefined,
    'help': help,
    'path': undefined, //path to the tinybuild script where the packager or plain bundler etc. are being run. defaults to look for 'tinybuild.js'
    'includeCore': (input, accumulator) => {
        accumulator.includeCore = input
        return null
    },
    'script': (input, accumulator) => {
        accumulator.initScript =  decodeURIComponent(input);  //encoded URI string of a javascript file
        return null
    },
    'cfgpath': undefined, //path to the config, require instead of stringifying config
    'config': (input, accumulator) => {
        Object.assign(accumulator, JSON.parse(input)); //encoded URI string of a packager config in its entirety.
        return null
    },
    'GLOBAL':undefined,
    'changed':undefined,
    'mobile':json,
    'electron':undefined,
    'tauri':undefined,
    'assets':json
}

export const bundler = {
    bundleBrowser: undefined, 
    bundleESM: undefined, 
    bundleTypes: undefined, 
    bundleNode: undefined, 
    bundleHTML: undefined, 
    bundleCommonJS: undefined, 
    bundleIIFE: undefined, 
    includeDefaultPlugins:undefined,
    entryPoints: (input) => {
        let entryPoints = [input]; //entry point script name to be created
        if(entryPoints.includes('[')) entryPoints = json(entryPoints);
    }, 
    outfile: json,
    outdir: json, 
    platform: json,
    external: json,
    globalThis: json,
    globals: json,
    init: json,
    minify: json,
    minifyWhitespace: json,
    sourcemap: json,
    outputs: json,
    blobWorkers:undefined,
    workerBundler:json
};


export const server = {
    'debug': json, // debug?
    'socket_protocol': json, //node server socket protocol (wss for hosted, or ws for localhost, depends)
    'pwa': json, //pwa service worker relative path
    'hotreload':  json, //pwa service worker relative path
    'delay': json,
    'hotreloadExtensions':json,
    'redirect': json,
    'reloadscripts':json,
    'keypath': json, //https key path
    'certpath': json, //https cert path
    'watch': json, //pwa service worker relative path
    'ignore': json, //pwa service worker relative path
    'extensions': json, //pwa service worker relative path
    'python': json, // python port
    'host': json, // node host
    'port': json, // node port
    'protocol': json, // node http or https protocols
    'startpage': json, // html page to start your app
}
