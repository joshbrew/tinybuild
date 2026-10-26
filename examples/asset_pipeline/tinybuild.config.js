// tinybuild:reference:guide:start
// Run `npx tinybuild` to build your files and start a local web server.
// Run `npx tinybuild config` for guided editing of common settings.
// Run `npx tinybuild preview` to see settings without building anything.
// Run `npx tinybuild validate --strict` to check for misspelled options.
//
// Settings without // are used as written, including settings with a false value.
// Settings starting with // are optional examples; they do nothing until enabled.
// Explanations also start with // and should stay commented out.
// To enable a setting, remove its first // and keep the explanation above it.
// For a whole object, remove one leading // from every line in that object.
// The extra // on explanation lines inside that object should stay in place.
// Change an existing setting instead of adding a second copy of the same name.
// Paths are relative to the folder where you run tinybuild.
// Command-line settings win over this file: `tinybuild --port 8081`.
// Use `tinybuild dev --open` to start development and open the browser.
// Use `tinybuild --envFile .env.local` to load values before reading this config.
// For deployment: `tinybuild build --production`, then `tinybuild serve --production`.
// `tinybuild status --url http://localhost:8080/_tinybuild/ready` checks a running server.
// `tinybuild options --search worker` explains matching settings from this reference.
// `tinybuild check --json` builds and checks your app for people or automation.
// `tinybuild init --list` shows ready-to-copy starters; --agentGuide adds agent notes.

/** @type {import('tinybuild').Config} */
// This example includes the full default reference; its active settings implement the demo.
// Reference blocks are refreshed by npm run sync:example-configs in the repository root.
// tinybuild:reference:guide:end
export default {
  // tinybuild:reference:modes:start
  // Build once and stop. Do not enable build and serve at the same time.
  // build: true,

  // Serve files that already exist, without building or copying them first.
  // serve: true,
  // tinybuild:reference:modes:end

  bundler: {
    entryPoints: ["index.js"],
    outdir: "dist",
    bundleESM: true,
    splitting: true,
    sourcemap: true,

    // tinybuild:reference:bundler:start
    // Full option reference. Edit an existing key above instead of adding it twice.
    // Choose which source files to build and which output formats to create.
    // BUILD: turn your source files into files a browser or Node.js can run.
    // To skip this step, replace this object with bundler: false.
    // For separate builds, use bundler: [{ ...firstBuild }, { ...secondBuild }].
    // Choose any combination of formats. Set bundleBrowser: false for a Node-only app.

    // The file where your app starts. Its imports are included automatically.
    // Use index.ts or index.tsx for TypeScript. Multiple entry files are allowed.
    // entryPoints: ["index.js"],

    // Where the built file goes. Tinybuild adds .js or the chosen format's suffix.
    // outfile: "dist/index",

    // Use a folder instead of outfile when building several entry files.
    // Remove outfile above before enabling this setting.
    // outdir: "dist",

    // Build a browser script for an ordinary <script> tag.
    // Each build format also accepts its own esbuild options instead of true.
    // bundleBrowser: true,

    // Build JavaScript modules for <script type="module"> or import statements.
    // bundleESM: true,

    // Create .d.ts files so other TypeScript projects know your exported types.
    // Install TypeScript 5.6+, 6.x or 7.x in your project to generate these files.
    // TypeScript entries give the most precise types; JavaScript entries work too.
    // bundleTypes: true,

    // Build code for Node.js, such as a backend server or command-line tool.
    // bundleNode: true,

    // Make one extra HTML file you can open or share without a web server.
    // Includes scripts, styles, workers, WebAssembly and imported file assets.
    // Native staging uses this generated page as its entry page too.
    // bundleHTML: true,

    // Build a self-running browser script with the .iife.js suffix in multi-format builds.
    // bundleIIFE: true,

    // Build CommonJS files for programs that use require().
    // bundleCommonJS: true,

    // Make built code smaller by shortening names, simplifying code and removing spaces.
    // Set false while debugging if you want to read the built code yourself.
    // minify: true,

    // Remove spaces and line breaks without changing names or simplifying expressions.
    // Set minify: false first if you want ONLY this smaller change.
    // minify: true already enables all three individual minify options.
    // minifyWhitespace: true,

    // true creates extra files that point browser errors back to your source lines.
    // Leave false for smaller output; enable it when you need to debug the source.
    // sourcemap: false,

    // Add esbuild plugins. Define or import myPlugin above this config.
    // A plugin with the same name as a built-in plugin replaces that plugin.
    // plugins: [myPlugin],

    // false removes Tinybuild's built-in plugins so you can supply your own set.
    // includeDefaultPlugins: false,

    // false saves workers as separate files; true embeds their code in browser URLs.
    // The default is true. Portable HTML embeds them even when this is false.
    // Import "./flow.worker" to load flow.worker.js or flow.worker.ts.
    // The .Worker spelling and full filenames such as flow.worker.js work too.
    // A file named flow.worker with no final extension is treated as JavaScript.
    // Create a worker with `tinybuild init --worker src/flow.Worker`.
    // Add --typescript for typed source and a matching URL declaration file.
    // Add --workerRuntime node for a Node worker instead of a browser worker.
    // blobWorkers: false,

    // Extra build settings just for worker code.
    // workerBundler: {
    //   // Write the worker as a JavaScript module.
    //   format: "esm",
    //
    //   // Remove spaces and line breaks from worker output.
    //   minifyWhitespace: true,
    // },

    // Put the browser build's exports on globalThis.MyLibrary.
    // Another script can then use MyLibrary.myExport without importing it.
    // globalThis: "MyLibrary",

    // Put selected exports directly on globalThis, such as globalThis.myExport.
    // The object key must match one of your entryPoints.
    // globals: {
    //   "index.js": ["myExport"],
    // },

    // Run a function in the browser after an entry's exports are ready.
    // init: {
    //   "index.js": (bundle) => console.log(bundle),
    // },

    // Copy SVG imports to files and return their URLs to your app.
    // loader: {
    //   ".svg": "file",
    //   ".xml": "file",
    //   ".html": "text",
    // },

    // Shorten variable names. Use with minify: false to choose this step separately.
    // minifyIdentifiers: true,

    // Simplify expressions. Use with minify: false to choose this step separately.
    // minifySyntax: true,

    // Save maximum-compression gzip copies of built scripts, styles and portable HTML.
    // For example, dist/index.js.gz is a smaller download of dist/index.js.
    // The originals stay available for browsers, local files and native app shells.
    // The Node server sends gzip when supported and useful; no app code changes needed.
    // This adds build time, so enable it when preparing downloads or production output.
    // bundleGzip: true,

    // Choose "module" for browser workers that use JavaScript module features.
    // Workers can create other workers too.
    // workerType: "module",

    // Name files loaded at runtime so portable HTML can include them too.
    // In your app: import url from "tinybuild:asset/settings"; then fetch(url).
    // runtimeAssets: {
    //   settings: "assets/settings.json",
    // },

    // false makes you install missing packages yourself instead of auto-installing.
    // Production and frozen builds always turn auto-installing off.
    // autoInstall: false,

    // Control imports loaded from web URLs and their downloaded cache.
    // remoteImports: {
    //   // Only use cached files; fail if a new download would be needed.
    //   frozen: true,
    //
    //   // true downloads a fresh copy instead of reusing a cached file.
    //   refresh: false,
    //
    //   // Folder used to save downloaded modules.
    //   cacheDir: ".tinybuild-cache",
    //
    //   // Stop downloads after this many milliseconds (15000 = 15 seconds).
    //   timeout: 15000,
    //
    //   // Reject a download larger than this many bytes (about 5 MB here).
    //   maxBytes: 5000000,
    // },

    // Change one output format's settings without changing the other formats.
    // outputs: {
    //   // Browser-only overrides apply to ordinary script output.
    //   browser: {
    //     target: "es2022",
    //   },
    //   // Only the ESM build uses this JavaScript language target.
    //   esm: {
    //     target: "es2022",
    //   },
    //   // Only the Node build leaves this package for Node to load at runtime.
    //   node: {
    //     external: ["optional-backend"],
    //   },
    //   // Settings for CommonJS files loaded with require().
    //   commonjs: {
    //     target: "es2022",
    //   },
    //   // Settings for self-running browser scripts.
    //   iife: {
    //     target: "es2022",
    //   },
    // },

    // Ordinary esbuild options also go here. For example, choose language support.
    // target: "es2022",

    // Choose the runtime esbuild should prepare code for: "browser" or "node".
    // bundleNode chooses "node" automatically for its output.
    // platform: "browser",

    // Node builds normally leave installed packages for Node to load at runtime.
    // Use "bundle" to include package code too, when those packages support it.
    // Native packages with .node files should stay outside a JavaScript bundle.
    // packages: "external",

    // Replace a name in your code with a value while building.
    // define: {
    //   APP_NAME: JSON.stringify("My App"),
    // },
    // tinybuild:reference:bundler:end
  },
  server: {
    host: "localhost",
    port: 8080,
    hotreload: true,

    // tinybuild:reference:server:start
    // Full option reference. Edit an existing key above instead of adding it twice.
    // Choose how the local or production web server serves your app.
    // SERVER: serve files and tell the browser when you edit them.
    // To skip serving, replace this object with server: false.

    // false keeps request logs quiet. true prints each path, status and duration as JSON.
    // Query strings and request headers are left out of these logs.
    // Also explain which saved files were grouped and why reload rebuilds or restarts.
    // debug: false,

    // "https" encrypts connections; also set keypath and certpath below.
    // protocol: "http",

    // "localhost" is for this computer. --lan allows phones and other LAN devices.
    // Add --qr to print a QR code and save an SVG of the reachable URL.
    // host: "localhost",

    // The number after the colon in your URL: http://localhost:8080.
    // 0 picks a free port and keeps it across config reloads in this session.
    // port: 8080,

    // The HTML file shown when someone opens the server URL.
    // startpage: "index.html",

    // Refresh the page after saved edits finish building. false turns this off.
    // Reload messages share the web server's port at /hotreload.
    // HTML, plain CSS and source saves are grouped into one settled update.
    // Build errors stay visible until the code builds successfully again.
    // Config errors stay visible until the config is repaired too.
    // Changing true to false pauses source watching; config edits can turn it back on.
    // Native liveReload keeps this enabled so edits can reach the app.
    // Edits made during the first build are picked up too.
    // hotreload: true,

    // Override the reload WebSocket scheme for a proxy setup: "ws" or "wss".
    // Usually leave this out; the browser chooses securely from the page URL.
    // socket_protocol: "ws",

    // Replace changed scripts without refreshing the whole page.
    // Use tinybuild/client/hot to save state and clean up timers or listeners.
    // reloadscripts: true,

    // Wait this many milliseconds after the LAST change before rebuilding.
    // 150 = 0.15 seconds. Higher values group slower multi-file saves together.
    // A build already in progress finishes before the next one starts.
    // delay: 150,

    // Folder containing files people can request. Files are read fresh.
    // root: "public",

    // Watch folders outside this project too, such as shared source files.
    // watch: ["../shared"],

    // Do not reload for edits in these paths. Built output is ignored automatically.
    // ignore: ["generated"],

    // Only react to these file extensions. Without this list, all watched types count.
    // extensions: ["js", "ts", "css", "html", "json"],

    // Open the browser when the CLI starts. Use "/settings" for a particular page.
    // This opens once at startup, rather than opening another tab after each save.
    // open: true,

    // Show this file when a requested page cannot be found.
    // errpage: "404.html",

    // Add response headers. These allow SharedArrayBuffer in supported browsers.
    // headers: {
    //   "Cross-Origin-Opener-Policy": "same-origin",
    //   "Cross-Origin-Embedder-Policy": "require-corp",
    // },

    // Handle a URL yourself. :name captures text into req.params.name.
    // Return true after sending your response to mark the request as handled.
    // routes: {
    //   // Map a URL to a file you supply in the project.
    //   "/page2": "mypage.html",
    //
    //   // Give one page its own HTML and response headers.
    //   "/custom": {
    //     // Extra headers for this page only.
    //     headers: {
    //       "Cache-Control": "no-store",
    //     },
    //     // Inline HTML to send instead of reading a file.
    //     template: "<h1>Hello from a custom page</h1>",
    //   },
    //
    //   // File routes can also have their own settings.
    //   "/file": {
    //     // File to read, relative to this project.
    //     path: "mypage.html",
    //     // HTTP status code for this response.
    //     status: 200,
    //   },
    //
    //   // Send one URL to a different site or page.
    //   "/redirect": {
    //     redirect: "https://example.com",
    //   },
    //
    //   // A handler can also be supplied directly as a function.
    //   "/other": async (req, res) => {
    //     res.end("Handled by the app");
    //     return true;
    //   },
    //
    //   // Override the homepage or the page used for missing files.
    //   "/": "index.html",
    //   "/404": "404.html",
    //
    //   "/hello/:name": {
    //     onrequest: async (req, res) => {
    //       res.end(req.params.name);
    //       return true;
    //     },
    //   },
    //
    //   // Capture several named pieces of a URL in the same request.
    //   "/user/:userId/:action": {
    //     onrequest: (req, res) => {
    //       res.end(`User ${req.params.userId} wants to ${req.params.action}`);
    //       return true;
    //     },
    //   },
    //
    //   // Different parameter values can share one file or HTML template.
    //   "/product/:productId": "product.html",
    //   "/posts/:year/:month/:slug": {
    //     template: "<h1>Blog post</h1>",
    //   },
    // },

    // If this port is busy during development, try this many following ports.
    // The printed URL always shows the port actually chosen. 0 disables retries.
    // Production always uses the exact configured port so deployments stay predictable.
    // portRetries: 5,

    // Use fresh .gz copies when a browser requests compressed downloads.
    // This is true by default. false serves the original files even if .gz files exist.
    // Create these copies with bundler.bundleGzip above.
    // precompressed: true,

    // Use "sse" if your proxy blocks WebSockets. The default is "ws".
    // SSE uses an ordinary HTTP stream at /hotreload/events.
    // hotreloadTransport: "sse",

    // Serve extra folders at particular URL prefixes.
    // staticRoots: {
    //   "/": "public",
    //   "/assets": "assets",
    // },

    // Show this HTML for app routes like /settings; your app chooses the page.
    // Missing file URLs and API requests still return 404.
    // spa: "index.html",

    // Forward matching requests to another server, such as a separate backend.
    // proxy: {
    //   "/api": {
    //     // The backend to contact.
    //     target: "http://127.0.0.1:7000",
    //
    //     // Remove /api first: /api/users becomes /users on the backend.
    //     stripPrefix: true,
    //
    //     // Forward WebSocket connections as well as HTTP requests.
    //     ws: true,
    //
    //     // Stop waiting for the backend after this many milliseconds.
    //     timeout: 10000,
    //
    //     // Maximum request body size in bytes (1048576 = 1 MiB).
    //     maxBodyBytes: 1048576,
    //   },
    // },

    // Allow these page origins to connect to reload streams and WebSockets.
    // Include the scheme, hostname and port used by the browser.
    // allowedOrigins: ["http://localhost:8080"],

    // A URL other tools can request to check whether the server is ready.
    // readinessPath: "/_tinybuild/ready",

    // Optionally check a database or another dependency before reporting ready.
    // Return false while unavailable. A thrown error also reports not ready.
    // The readiness URL returns 200 when ready and 503 otherwise.
    // During development, failed builds report not ready until a build succeeds.
    // isReady: async () => true,

    // Choose browser caching rules for production static files.
    // URL prefixes win over file extensions; "*" is the fallback for other files.
    // Use long-lived caching only where you change the URL when the file changes.
    // These rules do not affect development, APIs or forwarded backend responses.
    // cacheControl: {
    //   // Ask the server whether HTML changed before using a stored copy.
    //   ".html": "no-cache",
    //
    //   // Only put versioned or content-named files under this URL prefix.
    //   "/assets/": "public, max-age=31536000, immutable",
    //
    //   // Other static files are checked with the server before reuse.
    //   "*": "public, max-age=0, must-revalidate",
    // },

    // Give open connections this many milliseconds to finish when stopping.
    // shutdownTimeout: 5000,

    // Limit how long a client may take to send its HTTP request, in milliseconds.
    // requestTimeout: 30000,

    // Stop a response that sends nothing for this many milliseconds.
    // A stuck handler gets a 504 response. Active streams keep running.
    // Set 0 if an application intentionally waits indefinitely before responding.
    // responseTimeout: 30000,

    // Private key file for protocol: "https".
    // keypath: "server.key",

    // Certificate file for protocol: "https".
    // certpath: "server.crt",

    // Read an encrypted key's password from an environment variable.
    // passphrase: process.env.TLS_PASSWORD,

    // Send visitors to another site instead of serving local files.
    // redirect: "https://example.com",

    // Redirect code: 302 is temporary; 301 tells clients it is permanent.
    // redirectStatus: 302,

    // Connect the Node server's Python relay to a backend on this port.
    // The CLI option mode=python also starts Tinybuild's Python backend.
    // python: 7000,

    // Give Python-to-browser WebSocket clients a separate listening port.
    // Normally those clients use this web server's port, so this is optional.
    // Use this when your app connects to a dedicated relay URL such as ws://localhost:7001.
    // python_node: 7001,

    // Use a full Python WebSocket URL instead of the local port above.
    // pythonUrl: "ws://localhost:7000/",

    // Check the backend's TLS certificate when connecting to a wss:// URL.
    // pythonRejectUnauthorized: true,

    // Generate a service worker during builds to help a hosted app work offline.
    // For one portable HTML file instead, use bundler.bundleHTML.
    // This filename is relative to the served folder (dist by default in production).
    // pwa: "service-worker.js",

    // Send these response records to your own logger instead of using debug output.
    // A disconnected request reports status 499. Time is measured in milliseconds.
    // onRequest: (record) => console.log(JSON.stringify(record)),

    // Receive server errors in your own logging function.
    // onError: (error) => console.error(error),
    // tinybuild:reference:server:end
  },
  stats: true,

  // tinybuild:reference:options:start
  // More options. Edit existing keys above; uncomment only the features you need.
  // If this example calls nativeApp(...), edit its options there when using the macro.
  // ELECTRON: package the app with its own desktop browser runtime.
  // Debug launch: `tinybuild desktop=electron --devtools --inspect=9229`.
  // electron: {
  //   // stage prepares files; open runs; package/make create distributable apps.
  //   action: "stage",
  //
  //   // Folder for the Electron app shell. Your custom shell is kept.
  //   directory: "electron",
  //
  //   // Use the live server during open; false uses staged files instead.
  //   // Set true together with action: "open" for saved edits in the app.
  //   // With false, restart tinybuild to refresh the staged web files.
  //   liveReload: false,
  //
  //   // Open browser developer tools in the unpackaged app.
  //   devtools: true,
  //
  //   // Restart Electron when its main or preload script changes.
  //   // true watches the shell's main file and electron_preload.js.
  //   // Use a list of paths relative to the shell folder for a custom app.
  //   // Browser file edits still use ordinary hot reload without restarting Electron.
  //   // This requires action: "open" in development mode.
  //   // Leave false for stage/package; set true for main/preload relaunches.
  //   watch: false,
  //
  //   // Group main/preload edits made close together into one app restart.
  //   // Milliseconds: 150 = 0.15 seconds.
  //   restartDelay: 150,
  //
  //   // Debug Electron's Node process. 0 picks a free debugger port.
  //   inspect: 0,
  //
  //   // Extra arguments when launching Electron.
  //   args: ["--demo"],
  //
  //   // Initial window size, in pixels.
  //   window: {
  //     width: 1100,
  //     height: 720,
  //   },

  //
  //   // Packaged desktop app name.
  //   name: "MyApp",
  //
  //   // Folder for packaged output.
  //   outdir: "release",
  //
  //   // Operating system: win32, linux or darwin (macOS).
  //   platform: "win32",
  //
  //   // Target computer's processor architecture.
  //   arch: "x64",
  //
  //   // Formats Electron Forge creates when action is "make".
  //   makers: [
  //     {
  //       name: "@electron-forge/maker-zip",
  //     },
  //   ],
  //
  //   // Additional Electron Forge settings.
  //   forge: {},
  // },

  // TAURI: package a desktop app using the operating system's web view.
  // Debug launch: `tinybuild desktop=tauri`.
  // tauri: {
  //   // stage prepares files; dev runs with saved edits; build makes a release.
  //   action: "stage",
  //
  //   // Rust platform target. Omit this to build for your own computer.
  //   target: "x86_64-pc-windows-msvc",
  //
  //   // Installer formats for releases. nsis makes a Windows installer.
  //   bundles: ["nsis"],
  //
  //   // Set true together with action: "dev" to load the live web server.
  //   liveReload: false,
  //
  //   // false disables Tauri's Rust watcher, not Tinybuild's web reloading.
  //   watch: false,
  //
  //   // Optional Rust features already declared in your Tauri project.
  //   features: ["demo"],
  //
  //   // Make a debug executable instead of an optimized release executable.
  //   debug: true,
  //
  //   // false keeps installers enabled. true builds only the executable.
  //   // Remove bundles above before changing this to true.
  //   noBundle: false,
  // },

  // MOBILE: prepare, open or run Android/iOS apps using Capacitor.
  // Live reload needs a development server; server.production must be false too.
  // Debug Android: `tinybuild mobile=android --device emulator-5554`.
  // --connection usb, emulator or lan chooses how it reaches your server.
  // Debug iOS: `tinybuild mobile=ios --device <simulator-id>`.
  // Use --connection lan for a physical iOS device.
  // mobile: {
  //   // Settings for an Android app. iOS has its own settings below.
  //   android: {
  //     // stage prepares files; add creates the platform project; sync updates it.
  //     // open opens the SDK project; run builds, installs and launches the app.
  //     // build compiles the app without launching it.
  //     action: "run",
  //
  //     // Device/emulator ID from `tinybuild devices`.
  //     target: "emulator-5554",
  //
  //     // Load the live server to show saved edits in the app.
  //     liveReload: true,
  //
  //     // Connect over USB instead of your local network.
  //     connection: "usb",
  //
  //     // Optional Android product flavor already defined in your Gradle project.
  //     flavor: "demo",
  //   },
  //
  //   // false skips iOS. Use "stage" or an object like android above to enable it.
  //   // iOS also accepts scheme and configuration; host selects your LAN address.
  //   ios: false,
  // },

  // Extra files or folders to include when preparing a native app.
  // Use copy below for ordinary web output files.
  // assets: ["assets"],

  // STATIC FILES: copy images or other files that your code does not import.
  // A folder's contents are copied; for one file, to is the full new filename.
  // Saved edits and deletions are copied again during development.
  // copy: [
  //   {
  //     // Folder or file to copy from.
  //     from: "public",
  //
  //     // Destination folder, or exact filename when copying one file.
  //     to: "dist",
  //
  //     // Optional: leave Photoshop source files out of the copied output.
  //     filter: (path) => !path.endsWith(".psd"),
  //   },
  // ],

  // REMOTE COMPUTERS: run an existing project through SSH and forward its ports.
  // Set up SSH keys/host aliases and install the project on that computer first.
  // Preview without connecting: `tinybuild --remote mac --dryRun`.
  // Connect: `tinybuild --remote mac`. Source copying and OS installation are separate.
  // remotes: {
  //   mac: {
  //     // An SSH host alias, or a user@hostname from your own SSH setup.
  //     host: "mac-dev",
  //
  //     // Project directory on that computer, not on this one.
  //     directory: "/Users/developer/app",
  //
  //     // Use posix for macOS/Linux shells; use windows for PowerShell.
  //     platform: "posix",
  //
  //     // Program and arguments. false only forwards ports without starting a program.
  //     command: ["npm", "start"],
  //
  //     // Forward a local port to a loopback port on that computer.
  //     forwards: [
  //       {
  //         // Port to open on this computer, reachable only through localhost.
  //         local: 8080,
  //
  //         // Port used by the server on the remote computer.
  //         remote: 8080,
  //       },
  //     ],
  //
  //     // SSH connection port. This is separate from the web server's port.
  //     port: 22,
  //
  //     // Optional SSH private-key path. Prefer your SSH agent/config when possible.
  //     identityFile: "/path/to/your/private-key",
  //
  //     // Wait for the forwarded server to become ready before reporting success.
  //     ready: {
  //       // A local forwarded URL to check.
  //       url: "http://127.0.0.1:8080/_tinybuild/ready",
  //
  //       // Maximum startup wait, in milliseconds.
  //       timeout: 30000,
  //     },
  //   },
  // },

  // BUILD SIZE: print how many bytes were built and how long each build took.
  // stats: true,

  // PROJECT CHECKS: describe what a successful build should produce.
  // Run `tinybuild check` after editing. It builds with dependency installs disabled.
  // URL checks use a temporary local server that closes when the check finishes.
  // Add --stage to prepare configured native targets without running SDKs or devices.
  // checks: {
  //   // These files must exist inside the project after building.
  //   files: ["dist/index.js"],
  //
  //   // Request local paths and check their status and optional response text.
  //   urls: [
  //     {
  //       // Path on your temporary server, not a remote website.
  //       path: "/",
  //
  //       // HTTP status expected from that path. 200 means it loaded successfully.
  //       status: 200,
  //
  //       // Optional text that must appear in the response body, up to 2 MiB.
  //       includes: "<html",
  //     },
  //   ],
  //
  //   // Stop a URL check after this many milliseconds. 5000 = 5 seconds.
  //   timeout: 5000,
  // },

  // BUDGETS: optional size limits, like a spending limit for your built files.
  // Catch a new import that makes your app unexpectedly large.
  // All sizes are bytes. 1000 bytes is about 1 KB.
  // Totals include every build format, source maps and portable HTML you generate.
  // Leave this section commented out if you do not want size limits.
  // budgets: {
  //   // Maximum combined size of generated files before compression.
  //   totalBytes: 200000,
  //
  //   // Maximum size of one entry output file before compression.
  //   entryBytes: 100000,
  //
  //   // Maximum combined size after gzip compression, used for web downloads.
  //   // This estimates download size; configure compression on your hosting separately.
  //   gzipBytes: 60000,
  //
  //   // Maximum combined size after Brotli compression, another download format.
  //   brotliBytes: 50000,
  //
  //   // Allowed size increase compared with a previously saved build.
  //   // Save that build with `tinybuild baseline`; see diagnostics below.
  //   growthBytes: 1000,
  //
  //   // "error" fails the build if a limit is exceeded; "warn" only tells you.
  //   // If you leave onExceed out, Tinybuild uses "warn".
  //   onExceed: "error",
  // },

  // DIAGNOSTICS: optional measurements explaining the size of your built app.
  // These make reports and comparisons; budgets above set the limits.
  // diagnostics: {
  //   // Measure gzip and Brotli sizes as well as ordinary uncompressed sizes.
  //   compression: true,
  //
  //   // File containing a previous build's sizes, used to show size changes.
  //   // Run `tinybuild baseline` to create or deliberately update this file.
  //   // Commit it so your team compares against the same saved build.
  //   baseline: "tinybuild.baseline.json",
  //
  //   // Write an HTML page showing which files and dependencies take up space.
  //   // Open it in a browser after building to see what made the app large.
  //   report: "dist/report.html",
  // },

  // TASKS: start other programs with your app and stop them when Tinybuild closes.
  // For example, start an API backend and wait until it is ready.
  // tasks: {
  //   api: {
  //     // Program to run.
  //     command: "node",
  //
  //     // Arguments passed to that program, one item per argument.
  //     args: ["api.js"],
  //
  //     // Folder the program runs in, relative to this project.
  //     cwd: ".",
  //
  //     // Extra environment variables passed to the program.
  //     env: {
  //       PORT: "7000",
  //     },
  //
  //     // "service" stays running; "once" must finish before continuing.
  //     mode: "service",
  //
  //     // Wait until the program is ready before starting dependent tasks.
  //     ready: {
  //       // This URL must answer successfully. Use stdout: "READY" instead
  //       // of url if the program prints READY when it can accept work.
  //       url: "http://localhost:7000/ready",
  //
  //       // How long to wait for readiness, in milliseconds.
  //       timeout: 10000,
  //     },
  //
  //     // Restart this task when these files change.
  //     watch: ["api.js"],
  //
  //     // Wait this many milliseconds after the last edit before restarting.
  //     delay: 150,
  //   },
  //   prepare: {
  //     // Program used for a setup step.
  //     command: "node",
  //
  //     // Setup script to run.
  //     args: ["prepare.js"],
  //
  //     // Run once and require a successful exit before continuing.
  //     mode: "once",
  //
  //     // Stop this setup task if it takes more than 60 seconds.
  //     timeout: 60000,
  //
  //     // Start these tasks first. Stop tasks in the reverse order.
  //     dependsOn: ["api"],
  //   },
  // },

  // NATIVE APPS: share app settings across Electron, Tauri, Android and iOS.
  // "stage" prepares files without running an app or needing a platform SDK.
  // Restart tinybuild after changing native settings or the server's address/port.
  // Ordinary web edits hot reload; main/preload edits use electron.watch below.
  // native: {
  //   // Unique app ID, usually your reversed website name plus the app name.
  //   id: "com.example.app",
  //
  //   // App name shown to people.
  //   name: "My App",
  //
  //   // App version; use three numbers separated by dots.
  //   version: "1.0.0",
  //
  //   // App-store build counter. Increase it for each uploaded build.
  //   buildNumber: 1,
  //
  //   // Person or team making the app.
  //   author: "Example",
  //
  //   // Short description included in generated app metadata.
  //   description: "My app",
  //
  //   // Software license included in generated package metadata.
  //   license: "MIT",
  //
  //   // Platforms to prepare. Set a platform to false to skip it.
  //   targets: {
  //     electron: {
  //       action: "stage",
  //     },
  //     tauri: {
  //       action: "stage",
  //     },
  //     mobile: {
  //       android: "stage",
  //       ios: "stage",
  //     },
  //   },
  //
  //   // Add common device features and the permissions they need.
  //   // The app must still ask the person for permission at runtime.
  //   presets: [
  //     {
  //       name: "camera",
  //       description: "Scan a receipt.",
  //     },
  //     "files",
  //     "notifications",
  //   ],
  //
  //   // Extra native packages to install on a particular platform.
  //   // Secure storage needs a preset with a plugin provider you choose.
  //   plugins: [
  //     {
  //       target: "mobile",
  //       name: "@capacitor/share",
  //       version: "^8.0.0",
  //     },
  //   ],
  //
  //   // Extra platform permissions beyond those supplied by presets.
  //   permissions: {
  //     // Android permission names, such as "android.permission.CAMERA".
  //     android: [],
  //
  //     // iOS permission messages, e.g. NSCameraUsageDescription: "Take a photo".
  //     ios: {},
  //
  //     // Tauri capabilities allowed for the app's windows.
  //     tauri: ["core:default"],
  //   },
  //
  //   // Icon files or asset folders for each platform.
  //   icons: {
  //     electron: "icon.png",
  //     tauri: ["icons/32x32.png"],
  //     mobile: "assets",
  //   },
  //
  //   // Load the live web server inside the app to see saved edits quickly.
  //   devUrl: true,
  //
  //   // Your computer's LAN address when another device must reach that server.
  //   devHost: "192.168.1.2",
  //
  //   // Extra environment variables for native build commands.
  //   env: {
  //     APP_VARIANT: "debug",
  //   },
  //
  //   // Additional Capacitor settings merged into the mobile app config.
  //   capacitor: {
  //     plugins: {},
  //   },
  //
  //   // Additional Tauri settings merged into the desktop app config.
  //   tauri: {
  //     // Include a separate backend program in the native distribution.
  //     // Supply a compiled executable for each OS/CPU you build for.
  //     // The actual filename adds -<Rust target triple> and .exe on Windows.
  //     // See examples/tauri_sidecar for building, launching and stopping it.
  //     bundle: {
  //       externalBin: ["binaries/my-backend"],
  //     },
  //   },
  //
  //   // Named sets of settings for different builds of the same app.
  //   profiles: {
  //     debug: {
  //       name: "My App Debug",
  //     },
  //     release: {
  //       // Run your signing script after successful packaging.
  //       signing: {
  //         // Fail early if these environment variables are missing.
  //         requiredEnv: ["SIGNING_ID"],
  //
  //         // Program and arguments for your signing step.
  //         command: ["node", "sign.js"],
  //
  //         // Check the finished app's signature. A failed check fails this build.
  //         // Both scripts receive artifact folders in TINYBUILD_ARTIFACT_DIRS.
  //         verify: ["node", "verify-signature.js"],
  //       },
  //     },
  //   },
  //
  //   // Choose one of the profiles above. The CLI can override this with --profile.
  //   profile: "debug",
  // },

  // Choose a native profile here, or use `tinybuild --profile release`.
  // profile: "debug",

  // DEPLOYMENT: normally Tinybuild builds, serves and watches for edits.

  // Prepare production output: no reload, no package installs, cached URL imports.
  // The server uses dist as its default public folder in this mode.
  // production: true,

  // Prevent installs and new URL downloads without changing the server mode.
  // frozen: true,

  // Reject unknown config options instead of warning about them.
  // Helps catch typos such as "minfy" instead of "minify".
  // strictConfig: true,

  // Your own app settings go here so config validation knows they are intentional.
  // metadata: {
  //   applicationSpecific: "value",
  // },

  // MORE TOOLS: `tinybuild doctor` checks which optional build tools are installed.
  // `tinybuild doctor --report --json` collects selected settings and tool checks to share.
  // `tinybuild analyze` reports sizes. `tinybuild benchmark=5` times five builds.
  // `tinybuild clean --dryRun` lists unchanged generated files it could delete.
  // Remove --dryRun to clean them; edited files and custom native shells are kept.
  // `tinybuild bundle` is another way to request a single build.
  // `tinybuild path=other.config.js` selects another config, as --cfgpath does.
  // `tinybuild start path=server.js` runs and restarts your own Node startup script.
  // `tinybuild mode=python` starts the Python backend alongside your web app.
  // `tinybuild help` lists command-line options. --config accepts JSON overrides.
  // App helpers: tinybuild/client/hot saves state across script replacement;
  // tinybuild/client/workers runs/cancels worker jobs; tinybuild/client/native uses device bridges.
  // Native stage/preview need no SDK; running/compiling native apps needs platform tools.
  // tinybuild:reference:options:end
};
