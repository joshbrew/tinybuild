# Keep state while replacing scripts

```sh
npm start
```

Click **Increment**, then save `index.js`. The count stays in place while the script is replaced.

`hot.dispose` saves the count and removes the old listener. The next script reads that saved state and attaches its new listener. Async dispose/accept callbacks are awaited. Use `hot.invalidate()` when a full page reload is needed.

This example enables `server.reloadscripts`. Lazy chunk changes use a full page reload; these hooks manage your app's cleanup and state rather than replacing arbitrary imported modules.
