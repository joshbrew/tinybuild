import { json } from "./utils.js";

export const bundler = {
    bundleBrowser: json, 
    bundleESM: undefined, 
    bundleTypes: undefined, 
    bundleNode: undefined, 
    bundleHTML: undefined, 
    entryPoints: (input) => {
        const entryPoints = [input]; //entry point script name to be created
        if(entryPoints.includes('[')) entryPoints = json(tcfg.bundler.entryPoints);
    }, 
    outfile: json,
    outdir: json, 
    platform: json,
    external: json,
    globalThis: json,
    globals: json,
    init: json,
    minify: json
}