# PWA generation

Set server.pwa to generate a service worker during builds. Asset lists and versions derive from real outputs. The network-first worker falls back to cached responses or a defined 503 and only cleans caches for its own scope.

Supply your own manifest/icons and register the worker from application HTML. Match its URL to the static root. The configured worker receives Service-Worker-Allowed: /.

Production server startup creates no files.
