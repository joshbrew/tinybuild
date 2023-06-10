
import esbuild from 'esbuild'

import { hotreloadCachingPlugin } from './hotreloadPlugin'
import { defaultBundler } from '../bundler'
//we need a bundle step that runs the hotreload plugin without bundling/copying files otherwise, 
//   then we run a bundler on the resulting cache index.js


export function hotBundler(config=Object.assign({},defaultBundler), filters) {

    if(config.plugins) config.plugins = [...config.plugins]; //copy

    if(!config.plugins.find((p) => {if(p.name === 'hotreloadcacher') return true;})) {
        config.plugins.push(hotreloadCachingPlugin());
    } if(config.build.defaultBundler) {
        [...config.plugins].reverse().forEach((p,i) => {
            if(p.name === 'installer' || p.name === 'streamImports' || p.name === 'workerloader') {
                config.plugins.splice(config.plugins.length - 1 - i, 1);
            } //remove other plugins from this bundle
        })
    }

    config.bundle = false;

    esbuild.build({
        ...config
    })


}