# Add an esbuild plugin

Supply a virtual JavaScript module using a normal esbuild plugin.

```sh
npm start
```

`index.js` imports `virtual:build-info`. The plugin in `tinybuild.config.js` supplies its message. Edit that message to see the plugin participate in the build.
