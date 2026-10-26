# Workers as separate files

Emit a module worker beside your app so you can inspect and deploy its file.

```sh
npm start
```

The page sends 21 and displays 42. Look in `dist` for the worker output. `blobWorkers: false` selects files, and `index.js` creates a module worker from the imported URL.
