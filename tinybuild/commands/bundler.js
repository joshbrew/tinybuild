import { json } from "./utils.js";

export const bundler = {
    bundleBrowser: undefined, 
    bundleESM: undefined, 
    bundleTypes: undefined, 
    bundleNode: undefined, 
    bundleHTML: undefined, 
    bundleCommonJS: undefined, 
    bundleIIFE: undefined, 
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
    outputs: json

}