# Import an HTTP module

Build a module served by another HTTP server and cache its downloaded source.

```sh
node remote-server.js
```

Keep that terminal running, then run `npm start` here in a second terminal. The page displays the remote message. The alias plugin in `tinybuild.config.js` points `example-remote` at the demo server.
