# Copy static files into the build

```sh
npm start
```

Edit a file under `public` and save. Tinybuild copies it to `dist/static` and refreshes the page. Delete a source file and its unchanged generated copy is removed too.

`copy` works with or without bundling. A source directory copies its contents; a source file uses the exact destination filename. Filters select project-relative paths within the source. Private environment/key files and symlinks escaping the source are rejected.

From an installed project, use `npx tinybuild clean --dryRun` to inspect cleanup, then omit `--dryRun` to remove unchanged recorded outputs. Files you edited or tinybuild did not create stay in place. Native SDK shells are kept.
