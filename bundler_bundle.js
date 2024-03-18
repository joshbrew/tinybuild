import esbuild from 'esbuild'
import {defaultBundler} from './tinybuild/esbuild/bundler.js'

esbuild.build({
    entryPoints:['./tinybuild.js'],
    outfile:'dist/tinybuild.js',
    platform:'node',
    //format:'esm',
    bundle:true,
    loader:defaultBundler.loader
});