### Known Bugs

- Installing tinybuild locally and globally then running hotreload server config can trigger both library locations for some reason. Our previous measures don't seem to work anymore.
- redirect can cache and break localhost on non-redirect servers because of caching (??)

### Enhancements

- optimize hotreload plugin settings somehow for the bundle step, still a lot faster for fat apps than before when we were rebundling entirely

### QOL

Redo some of the templating logic so it's more intelligent to your repository

Explore a hotreloading system where we copy css files for example to an isolated build so they can hotreload much quicker in large projects.
 - Requires a new runAndWatch command that will decide which bundle to run based on which paths resolve from chokidar.watch
 - Temp write css caches only for hotreload mode since this is pointless otherwise, use an esbuild plugin that collects the files into node_modules/.cache folder just to keep it out of the way
 - Include consideration for the worker plugin too as rebundling those every time can be cumbersome for large programs in workers