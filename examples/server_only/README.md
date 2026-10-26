# Serve pages and an API

Use the Node server with existing files and no bundling step.

```sh
npm start
```

Open the printed URL, then visit `/api/time` for a JSON response. Edit `index.html` and refresh to see it. After editing the `/api/time` handler in `tinybuild.config.js`, restart the server. `bundler: false` keeps this a server-only project.
