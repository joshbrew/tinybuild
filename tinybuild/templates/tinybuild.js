import { packager } from "tinybuild";

let config = {
    bundler: {
        entryPoints: ['index.js'],
        outfile: 'dist/index',
        bundleBrowser: true, //plain js format
        bundleESM: false, //.esm format
        bundleTypes: false, //entry point should be a ts or jsx (or other typescript) file
        bundleNode: false, // bundle a package with platform:node and separate externals
        bundleHTML: true, //can wrap the built outfile (or first file in outdir) automatically and serve it or click and run the file without hosting.
        minify: true,
        sourcemap: false
        //globalThis:null //'mymodule'
        //globals:{'index.js':['Graph']}
        //init:{'index.js':function(bundle) { console.log('prepackaged bundle script!', bundle); }}      
    },
    server: defaultServer
}


packager(config); // bundle and serve
