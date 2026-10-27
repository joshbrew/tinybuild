import type { BuildOptions, BuildResult, Plugin } from "esbuild";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
export interface ProjectChecks {
  /**
   * These files must exist inside the project after building.
   * @tinybuildOption checks.files
   */
  files?: string[];

  /**
   * Request local paths and check their status and optional response text.
   * @tinybuildOption checks.urls
   */
  urls?: Array<{ path: string; status?: number; includes?: string }>;

  /**
   * Stop a URL check after this many milliseconds. 5000 = 5 seconds.
   * @tinybuildOption checks.timeout
   */
  timeout?: number;
}
export interface BuildEvent {
  schemaVersion: 1;
  type:
    | "building"
    | "built"
    | "build-error"
    | "ready"
    | "closed"
    | "reload"
    | "artifacts";
  sequence: number;
  time: string;
  files?: string[];
  stats?: BuildStats;
  url?: string;
  ok?: boolean;
  error?: { message: string };
  /** Present on reload trace events when server.debug is enabled. */
  action?: "batch" | "queued" | "config" | "rebuild" | "static";
  message?: string;
  delay?: number;
  services?: string[];
  artifacts?: NativeResult["artifacts"];
}
export function checkProject(
  config: Config,
  options?: {
    cwd?: string;
    stage?: boolean;
    signal?: AbortSignal;
    onWarning?: (message: string) => void;
  },
): Promise<{
  ok: true;
  steps: Array<{ name: string; ok: boolean; path?: string; skipped?: boolean }>;
  native: { staging: string; sdk: string; device: string; signing: string };
}>;
export function optionReference(search?: string): Array<{
  path: string;
  description: string;
  example: string;
  default?: string | number | boolean;
  type?: string;
}>;
export function doctor(
  cwd?: string,
  options?: {
    target?: "browser" | "node" | "electron" | "tauri" | "android" | "ios";
  },
): Array<{
  name: string;
  ok: boolean;
  optional?: boolean;
  detail?: string;
  remedy: string;
}>;
export const starterRecipes: Array<{ name: string; description: string }>;
/** Selected settings and prerequisite checks; excludes env, headers, commands and custom metadata. */
export function doctorReport(
  config?: Config,
  options?: {
    cwd?: string;
    target?: "browser" | "node" | "electron" | "tauri" | "android" | "ios";
  },
): {
  ok: boolean;
  runtime: {
    tinybuild: string;
    node: string;
    esbuild: string;
    platform: string;
    arch: string;
  };
  tools: ReturnType<typeof doctor>;
  project: {
    profile?: string;
    outputs: Array<
      Partial<ReturnType<typeof previewConfig>["outputs"][number]>
    >;
    server: false | Partial<ServerConfig>;
    tasks: string[];
    native: Array<{ target: string; action: string; directory: string }>;
  };
  validation: { errors: string[]; warnings: string[] };
};
export function listStarters(search?: string): typeof starterRecipes;
export function scaffoldWorker(
  name: string,
  options?: {
    cwd?: string;
    typescript?: boolean;
    runtime?: "browser" | "node";
    dryRun?: boolean;
  },
): Promise<{
  cwd: string;
  runtime: "browser" | "node";
  typescript: boolean;
  dryRun: boolean;
  files: string[];
  specifier: string;
  usage: string;
  settings: Partial<BundlerConfig>;
  next: string[];
}>;
export function addAgentGuide(cwd: string): Promise<boolean>;
export function initStarter(
  name: string,
  options?: { cwd?: string; agentGuide?: boolean },
): Promise<{
  cwd: string;
  recipe: string;
  files: string[];
  next: string[];
  stop: string;
}>;
export interface BundlerConfig extends Omit<BuildOptions, "outfile"> {
  /**
   * Make built code smaller by shortening names, simplifying code and removing spaces. Set false while debugging if you want to read the built code yourself.
   * @tinybuildOption bundler.minify
   */
  minify?: boolean;

  /**
   * true creates extra files that point browser errors back to your source lines. Leave false for smaller output; enable it when you need to debug the source.
   * @tinybuildOption bundler.sourcemap
   */
  sourcemap?: BuildOptions["sourcemap"];

  /**
   * Where the built file goes. Tinybuild adds .js or the chosen format's suffix.
   * @tinybuildOption bundler.outfile
   */
  outfile?: string;

  /**
   * Build a browser script for an ordinary <script> tag. Each build format also accepts its own esbuild options instead of true.
   * @tinybuildOption bundler.bundleBrowser
   */
  bundleBrowser?: boolean | BuildOptions;

  /**
   * Build JavaScript modules for <script type="module"> or import statements.
   * @tinybuildOption bundler.bundleESM
   */
  bundleESM?: boolean | BuildOptions;

  /**
   * Build code for Node.js, such as a backend server or command-line tool.
   * @tinybuildOption bundler.bundleNode
   */
  bundleNode?: boolean | BuildOptions;

  /**
   * Build CommonJS files for programs that use require().
   * @tinybuildOption bundler.bundleCommonJS
   */
  bundleCommonJS?: boolean | BuildOptions;

  /**
   * Build a self-running browser script with the .iife.js suffix in multi-format builds.
   * @tinybuildOption bundler.bundleIIFE
   */
  bundleIIFE?: boolean | BuildOptions;

  /**
   * Create .d.ts files so other TypeScript projects know your exported types. Install TypeScript 5.6+, 6.x or 7.x in your project to generate these files. TypeScript entries give the most precise types; JavaScript entries work too.
   * @tinybuildOption bundler.bundleTypes
   */
  bundleTypes?: boolean;

  /**
   * Make one extra HTML file you can open or share without a web server. Includes scripts, styles, workers, WebAssembly and imported file assets. Native staging uses this generated page as its entry page too.
   * @tinybuildOption bundler.bundleHTML
   */
  bundleHTML?: boolean;

  /**
   * Save maximum-compression gzip copies of built scripts, styles and portable HTML. For example, dist/index.js.gz is a smaller download of dist/index.js. The originals stay available for browsers, local files and native app shells. The Node server sends gzip when supported and useful; no app code changes needed. This adds build time, so enable it when preparing downloads or production output.
   * @tinybuildOption bundler.bundleGzip
   */
  bundleGzip?: boolean;

  /**
   * false removes Tinybuild's built-in plugins so you can supply your own set.
   * @tinybuildOption bundler.includeDefaultPlugins
   */
  includeDefaultPlugins?: boolean;

  /**
   * false saves workers as separate files; true embeds their code in browser URLs. The default is true. Portable HTML embeds them even when this is false. Import "./flow.worker" to load flow.worker.js or flow.worker.ts. The .Worker spelling and full filenames such as flow.worker.js work too. A file named flow.worker with no final extension is treated as JavaScript. Create a worker with `tinybuild init --worker src/flow.Worker`. Add --typescript for typed source and a matching URL declaration file. Add --workerRuntime node for a Node worker instead of a browser worker.
   * @tinybuildOption bundler.blobWorkers
   */
  blobWorkers?: boolean;

  /**
   * Extra build settings just for worker code.
   * @tinybuildOption bundler.workerBundler
   */
  workerBundler?: BuildOptions;

  /**
   * Choose "module" for browser workers that use JavaScript module features. Workers can create other workers too.
   * @tinybuildOption bundler.workerType
   */
  workerType?: "module" | "classic";

  /**
   * Name files loaded at runtime so portable HTML can include them too. In your app: import url from "tinybuild:asset/settings"; then fetch(url).
   * @tinybuildOption bundler.runtimeAssets
   */
  runtimeAssets?: Record<string, string>;

  /**
   * false makes you install missing packages yourself instead of auto-installing. Production and frozen builds always turn auto-installing off.
   * @tinybuildOption bundler.autoInstall
   */
  autoInstall?: boolean;

  /**
   * Control imports loaded from web URLs and their downloaded cache.
   * @tinybuildOption bundler.remoteImports
   */
  remoteImports?: {
    frozen?: boolean;
    refresh?: boolean;
    cacheDir?: string;
    timeout?: number;
    maxBytes?: number;
  };

  /**
   * Change one output format's settings without changing the other formats.
   * @tinybuildOption bundler.outputs
   */
  outputs?: Partial<
    Record<"browser" | "esm" | "node" | "commonjs" | "iife", BuildOptions>
  >;

  /**
   * Put the browser build's exports on globalThis.MyLibrary. Another script can then use MyLibrary.myExport without importing it.
   * @tinybuildOption bundler.globalThis
   */
  globalThis?: string;

  /**
   * Put selected exports directly on globalThis, such as globalThis.myExport. The object key must match one of your entryPoints.
   * @tinybuildOption bundler.globals
   */
  globals?: Record<string, string[]>;

  /**
   * Run a function in the browser after an entry's exports are ready.
   * @tinybuildOption bundler.init
   */
  init?: Record<string, string | Function>;
}
export type RequestHandler = (
  request: IncomingMessage & { params?: Record<string, string> },
  response: ServerResponse,
) => unknown | Promise<unknown>;
export type Route =
  | string
  | RequestHandler
  | {
      path?: string;
      template?: string;
      redirect?: string;
      status?: number;
      headers?: Record<string, string>;
      onrequest?: RequestHandler;
    };
export interface ServerConfig {
  cwd?: string;

  /**
   * Folder containing files people can request. Files are read fresh.
   * @tinybuildOption server.root
   */
  root?: string;

  /**
   * Serve extra folders at particular URL prefixes.
   * @tinybuildOption server.staticRoots
   */
  staticRoots?: Record<string, string>;

  /**
   * "localhost" is for this computer. --lan allows phones and other LAN devices. Add --qr to print a QR code and save an SVG of the reachable URL.
   * @tinybuildOption server.host
   */
  host?: string;

  /**
   * The number after the colon in your URL: http://localhost:8080. 0 picks a free port and keeps it across config reloads in this session.
   * @tinybuildOption server.port
   */
  port?: number;

  /**
   * If this port is busy during development, try this many following ports. The printed URL always shows the port actually chosen. 0 disables retries. Production always uses the exact configured port so deployments stay predictable.
   * @tinybuildOption server.portRetries
   */
  portRetries?: number;

  /**
   * Open the browser when the CLI starts. Use "/settings" for a particular page. This opens once at startup, rather than opening another tab after each save.
   * @tinybuildOption server.open
   */
  open?: boolean | string;

  /**
   * Choose browser caching rules for production static files. URL prefixes win over file extensions; "*" is the fallback for other files. Use long-lived caching only where you change the URL when the file changes. These rules do not affect development, APIs or forwarded backend responses.
   * @tinybuildOption server.cacheControl
   */
  cacheControl?: Record<string, string>;

  /**
   * Optionally check a database or another dependency before reporting ready. Return false while unavailable. A thrown error also reports not ready. The readiness URL returns 200 when ready and 503 otherwise. During development, failed builds report not ready until a build succeeds.
   * @tinybuildOption server.isReady
   */
  isReady?: () => boolean | Promise<boolean>;

  /**
   * Stop a response that sends nothing for this many milliseconds. A stuck handler gets a 504 response. Active streams keep running. Set 0 if an application intentionally waits indefinitely before responding.
   * @tinybuildOption server.responseTimeout
   */
  responseTimeout?: number;

  /**
   * Send these response records to your own logger instead of using debug output. A disconnected request reports status 499. Time is measured in milliseconds.
   * @tinybuildOption server.onRequest
   */
  onRequest?: (request: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
  }) => void;

  /**
   * "https" encrypts connections; also set keypath and certpath below.
   * @tinybuildOption server.protocol
   */
  protocol?: "http" | "https";

  /**
   * Private key file for protocol: "https".
   * @tinybuildOption server.keypath
   */
  keypath?: string;

  /**
   * Certificate file for protocol: "https".
   * @tinybuildOption server.certpath
   */
  certpath?: string;

  /**
   * Read an encrypted key's password from an environment variable.
   * @tinybuildOption server.passphrase
   */
  passphrase?: string;

  /**
   * The HTML file shown when someone opens the server URL.
   * @tinybuildOption server.startpage
   */
  startpage?: string;

  /**
   * Show this file when a requested page cannot be found.
   * @tinybuildOption server.errpage
   */
  errpage?: string;

  /**
   * Refresh the page after saved edits finish building. false turns this off. Reload messages share the web server's port at /hotreload. HTML, plain CSS and source saves are grouped into one settled update. Build errors stay visible until the code builds successfully again. Config errors stay visible until the config is repaired too. Changing true to false pauses source watching; config edits can turn it back on. Native liveReload keeps this enabled so edits can reach the app. Edits made during the first build are picked up too.
   * @tinybuildOption server.hotreload
   */
  hotreload?: boolean | number;

  /**
   * Use "sse" if your proxy blocks WebSockets. The default is "ws". SSE uses an ordinary HTTP stream at /hotreload/events.
   * @tinybuildOption server.hotreloadTransport
   */
  hotreloadTransport?: "ws" | "sse";

  /**
   * Override the reload WebSocket scheme for a proxy setup: "ws" or "wss". Usually leave this out; the browser chooses securely from the page URL.
   * @tinybuildOption server.socket_protocol
   */
  socket_protocol?: "ws" | "wss";

  /**
   * Allow these page origins to connect to reload streams and WebSockets. Include the scheme, hostname and port used by the browser.
   * @tinybuildOption server.allowedOrigins
   */
  allowedOrigins?: string[];

  /**
   * Replace changed scripts without refreshing the whole page. Use tinybuild/client/hot to save state and clean up timers or listeners.
   * @tinybuildOption server.reloadscripts
   */
  reloadscripts?: boolean;

  /**
   * Handle a URL yourself. :name captures text into req.params.name. Return true after sending your response to mark the request as handled.
   * @tinybuildOption server.routes
   */
  routes?: Record<string, Route>;

  /**
   * Add response headers. These allow SharedArrayBuffer in supported browsers.
   * @tinybuildOption server.headers
   */
  headers?: Record<string, string>;

  /**
   * Watch folders outside this project too, such as shared source files.
   * @tinybuildOption server.watch
   */
  watch?: string[];

  /**
   * Do not reload for edits in these paths. Built output is ignored automatically.
   * @tinybuildOption server.ignore
   */
  ignore?: string[];

  /**
   * Only react to these file extensions. Without this list, all watched types count.
   * @tinybuildOption server.extensions
   */
  extensions?: string[];
  production?: boolean;

  /**
   * Generate a service worker during builds to help a hosted app work offline. For one portable HTML file instead, use bundler.bundleHTML. This filename is relative to the served folder (dist by default in production).
   * @tinybuildOption server.pwa
   */
  pwa?: string;

  /**
   * Wait this many milliseconds after the LAST change before rebuilding. 150 = 0.15 seconds. Higher values group slower multi-file saves together. A build already in progress finishes before the next one starts.
   * @tinybuildOption server.delay
   */
  delay?: number;

  /**
   * A URL other tools can request to check whether the server is ready.
   * @tinybuildOption server.readinessPath
   */
  readinessPath?: string;

  /**
   * Give open connections this many milliseconds to finish when stopping.
   * @tinybuildOption server.shutdownTimeout
   */
  shutdownTimeout?: number;

  /**
   * Limit how long a client may take to send its HTTP request, in milliseconds.
   * @tinybuildOption server.requestTimeout
   */
  requestTimeout?: number;

  /**
   * Use fresh .gz copies when a browser requests compressed downloads. This is true by default. false serves the original files even if .gz files exist. Create these copies with bundler.bundleGzip above.
   * @tinybuildOption server.precompressed
   */
  precompressed?: boolean;

  /**
   * Show this HTML for app routes like /settings; your app chooses the page. Missing file URLs and API requests still return 404.
   * @tinybuildOption server.spa
   */
  spa?: boolean | string;

  /**
   * Forward matching requests to another server, such as a separate backend.
   * @tinybuildOption server.proxy
   */
  proxy?: Record<
    string,
    | string
    | {
        target: string;
        ws?: boolean;
        stripPrefix?: boolean;
        changeOrigin?: boolean;
        headers?: Record<string, string>;
        timeout?: number;
        maxBodyBytes?: number;
      }
  >;

  /**
   * Connect the Node server's Python relay to a backend on this port. The CLI option mode=python also starts Tinybuild's Python backend.
   * @tinybuildOption server.python
   */
  python?: number | false;

  /**
   * Give Python-to-browser WebSocket clients a separate listening port. Normally those clients use this web server's port, so this is optional. Use this when your app connects to a dedicated relay URL such as ws://localhost:7001.
   * @tinybuildOption server.python_node
   */
  python_node?: number;

  /**
   * Use a full Python WebSocket URL instead of the local port above.
   * @tinybuildOption server.pythonUrl
   */
  pythonUrl?: string;

  /**
   * Check the backend's TLS certificate when connecting to a wss:// URL.
   * @tinybuildOption server.pythonRejectUnauthorized
   */
  pythonRejectUnauthorized?: boolean;

  /**
   * Receive server errors in your own logging function.
   * @tinybuildOption server.onError
   */
  onError?: (error: Error) => void;
}
export interface Config {
  /**
   * Choose which source files to build and which output formats to create.
   * @tinybuildOption bundler
   */
  bundler?: BundlerConfig | BundlerConfig[] | false;

  /**
   * Choose how the local or production web server serves your app.
   * @tinybuildOption server
   */
  server?: ServerConfig | false;

  /**
   * Build once and stop. Do not enable build and serve at the same time.
   * @tinybuildOption build
   */
  build?: boolean;

  /**
   * Serve files that already exist, without building or copying them first.
   * @tinybuildOption serve
   */
  serve?: boolean;

  /**
   * Prepare production output: no reload, no package installs, cached URL imports. The server uses dist as its default public folder in this mode.
   * @tinybuildOption production
   */
  production?: boolean;

  /**
   * Prevent installs and new URL downloads without changing the server mode.
   * @tinybuildOption frozen
   */
  frozen?: boolean;

  /**
   * BUILD SIZE: print how many bytes were built and how long each build took.
   * @tinybuildOption stats
   */
  stats?: boolean;

  /**
   * NATIVE APPS: share app settings across Electron, Tauri, Android and iOS. "stage" prepares files without running an app or needing a platform SDK. Restart tinybuild after changing native settings or the server's address/port. Ordinary web edits hot reload; main/preload edits use electron.watch below.
   * @tinybuildOption native
   */
  native?: NativeApp;

  /**
   * Choose a native profile here, or use `tinybuild --profile release`.
   * @tinybuildOption profile
   */
  profile?: string;

  /**
   * BUDGETS: optional size limits, like a spending limit for your built files. Catch a new import that makes your app unexpectedly large. All sizes are bytes. 1000 bytes is about 1 KB. Totals include every build format, source maps and portable HTML you generate. Leave this section commented out if you do not want size limits.
   * @tinybuildOption budgets
   */
  budgets?: BuildBudgets;

  /**
   * TASKS: start other programs with your app and stop them when Tinybuild closes. For example, start an API backend and wait until it is ready.
   * @tinybuildOption tasks
   */
  tasks?: Record<string, TaskConfig>;

  /**
   * Extra files or folders to include when preparing a native app. Use copy below for ordinary web output files.
   * @tinybuildOption assets
   */
  assets?: string[];

  /**
   * STATIC FILES: copy images or other files that your code does not import. A folder's contents are copied; for one file, to is the full new filename. Saved edits and deletions are copied again during development.
   * @tinybuildOption copy
   */
  copy?: Array<{
    from: string;
    to: string;
    filter?: (relativePath: string) => boolean;
  }>;

  /**
   * Reject unknown config options instead of warning about them. Helps catch typos such as "minfy" instead of "minify".
   * @tinybuildOption strictConfig
   */
  strictConfig?: boolean;

  /**
   * Your own app settings go here so config validation knows they are intentional.
   * @tinybuildOption metadata
   */
  metadata?: Record<string, unknown>;

  /**
   * REMOTE COMPUTERS: run an existing project through SSH and forward its ports. Set up SSH keys/host aliases and install the project on that computer first. Preview without connecting: `tinybuild --remote mac --dryRun`. Connect: `tinybuild --remote mac`. Source copying and OS installation are separate.
   * @tinybuildOption remotes
   */
  remotes?: Record<string, RemoteConfig>;

  /**
   * DIAGNOSTICS: optional measurements explaining the size of your built app. These make reports and comparisons; budgets above set the limits.
   * @tinybuildOption diagnostics
   */
  diagnostics?: { compression?: boolean; baseline?: string; report?: string };

  /**
   * PROJECT CHECKS: describe what a successful build should produce. Run `tinybuild check` after editing. It builds with dependency installs disabled. URL checks use a temporary local server that closes when the check finishes. Add --stage to prepare configured native targets without running SDKs or devices.
   * @tinybuildOption checks
   */
  checks?: ProjectChecks;

  /**
   * ELECTRON: package the app with its own desktop browser runtime. Debug launch: `tinybuild desktop=electron --devtools --inspect=9229`.
   * @tinybuildOption electron
   */
  electron?:
    | boolean
    | string
    | {
        action?: "stage" | "open" | "package" | "make";
        directory?: string;
        name?: string;
        outdir?: string;
        platform?: string;
        arch?: string;
        liveReload?: boolean;
        devtools?: boolean;
        inspect?: boolean | number;
        args?: string[];
        watch?: boolean | string[];
        restartDelay?: number;
        window?: DesktopWindow;
        makers?: Array<{
          name: string;
          version?: string;
          platforms?: string[];
          config?: Record<string, unknown>;
        }>;
        forge?: Record<string, unknown>;
      };

  /**
   * TAURI: package a desktop app using the operating system's web view. Debug launch: `tinybuild desktop=tauri`.
   * @tinybuildOption tauri
   */
  tauri?:
    | boolean
    | {
        action?: "stage" | "dev" | "build";
        target?: string;
        bundles?: string[];
        liveReload?: boolean;
        features?: string[];
        debug?: boolean;
        noBundle?: boolean;
        watch?: boolean;
      };

  /**
   * MOBILE: prepare, open or run Android/iOS apps using Capacitor. Live reload needs a development server; server.production must be false too. Debug Android: `tinybuild mobile=android --device emulator-5554`. --connection usb, emulator or lan chooses how it reaches your server. Debug iOS: `tinybuild mobile=ios --device <simulator-id>`. Use --connection lan for a physical iOS device.
   * @tinybuildOption mobile
   */
  mobile?:
    | false
    | {
        android?: MobileAction;
        ios?: MobileAction;
      };
}
export type BundleResult = BuildResult & {
  html?: string;
  htmlFiles?: string[];
  gzipFiles?: string[];
};
export type Bundles = Array<
  { config: BundlerConfig } & Partial<
    Record<"browser" | "esm" | "node" | "commonjs" | "iife", BundleResult>
  > & {
      ts?: { outputs: Array<{ path: string; text: string }> };
      assets?: { files: string[]; metafile: import("esbuild").Metafile };
    }
>;
export interface ServerController extends ServerConfig {
  SERVER: Server;
  SOCKETS: Record<string, unknown>;
  port: number;
  url: string;
  setStartpage(filename: string): void;
  setReady(ready: boolean): void;
  requestedPort: number;
  close(): Promise<void>;
}
export interface BuildStats {
  builds: number;
  durationMs: number;
  outputBytes: number;
  files: string[];
  reason?: { type: "initial" | "files" | "manual" | "config"; files: string[] };
  violations?: BuildViolation[];
}
export interface AppController {
  bundles: Bundles;
  server?: ServerController;
  stats: BuildStats;
  report?: BuildReport;
  tasks?: TaskController;
  lanURLs?: string[];
  native?: NativeResult;
  ready: Promise<AppController>;
  rebuild(changed?: string[]): Promise<unknown>;
  close(): Promise<void>;
}
/** Progress for a build format or copied assets, including output sizes and elapsed time. */
export interface BuildProgress {
  target: "browser" | "esm" | "node" | "commonjs" | "iife" | "types" | "assets";
  format?: string;
  phase: "start" | "end";
  durationMs?: number;
  outputs?: Array<{ path: string; bytes: number }>;
}
export function packager(
  config?: Config,
  options?:
    | boolean
    | {
        cwd?: string;
        watch?: boolean;
        configPath?: string;
        overrides?: Config;
        onError?: (error: Error) => void;
        onBuild?: (stats: BuildStats) => void;
        onWarning?: (message: string) => void;
        onReady?: (app: AppController) => void | Promise<void>;
        onEvent?: (event: BuildEvent) => void;
        onProgress?: (progress: BuildProgress) => void;
        log?: (message: string) => void;
        signal?: AbortSignal;
        tasks?: TaskOptions;
        native?: {
          dryRun?: boolean;
          devUrl?: string;
          signal?: AbortSignal;
          run?: Function;
          sign?: Function;
        };
      },
): Promise<AppController>;
export function bundle(
  config?: BundlerConfig | BundlerConfig[],
  options?: { onProgress?: (progress: BuildProgress) => void },
): Promise<Bundles>;
export function bundleBrowser(config: BundlerConfig): Promise<BundleResult>;
export function bundleESM(
  config: BundlerConfig,
  alterPath?: boolean,
): Promise<BundleResult>;
export function bundleNode(
  config: BundlerConfig,
  alterPath?: boolean,
): Promise<BundleResult>;
export function bundleCommonJS(
  config: BundlerConfig,
  alterPath?: boolean,
): Promise<BundleResult>;
export function bundleTypes(
  config: BundlerConfig,
): Promise<{ outputs: Array<{ path: string; text: string }> }>;
export function serve(config?: ServerConfig): Promise<ServerController>;
export function workerPlugin(options?: {
  blobWorkers?: boolean;
  bundler?: BuildOptions;
  workerType?: "module" | "classic";
}): Plugin;
export function createStreamingImportsPlugin(
  options?: BundlerConfig["remoteImports"],
): Plugin;
export const streamingImportsPlugin: Plugin;
export function createInstallerPlugin(options?: {
  enabled?: boolean;
  install?: Function;
}): Plugin;
export const installerPlugin: Plugin;
export function runtimeAssetsPlugin(assets?: Record<string, string>): Plugin;
export const defaultConfig: Config;
export const defaultBundler: BundlerConfig;
export const defaultServer: ServerConfig;
export function runTinybuild(
  args?: string[] | Config,
  options?: object,
): Promise<unknown>;
export function initRepo(
  dirName?: string,
  entryPoints?: string | string[],
  initScript?: string,
  config?: Config,
  includeCore?: boolean,
): Promise<string>;
export function stageWeb(
  config: Config,
  results: Bundles,
  destination: string,
  options?: { cwd?: string },
): Promise<{ directory: string; html: string; files: string[] }>;
export function packageNative(
  config: Config,
  results: Bundles,
  options?: {
    cwd?: string;
    dryRun?: boolean;
    run?: Function;
    sign?: Function;
    devUrl?: string;
    signal?: AbortSignal;
  },
): Promise<NativeResult>;
export function createBuildContexts(
  config?: BundlerConfig | BundlerConfig[],
  options?: { onProgress?: (progress: BuildProgress) => void },
): Promise<{ rebuild(): Promise<Bundles>; dispose(): Promise<void> }>;
export function normalizeBuildOptions(
  config?: BundlerConfig,
  target?: "browser" | "esm" | "node" | "commonjs" | "iife",
  alterPath?: boolean,
): BuildOptions;
export function bundleHTML(fromJSPath: string, config?: BundlerConfig): string;
export function hotBundle(
  config?: BundlerConfig,
  changed?: string,
): Promise<{ skipped: boolean; changed: string; bundles: Bundles }>;
export const hotBundleImmediate: typeof hotBundle;
export function disposeHotBundles(): Promise<void>;
export function hotreloadPlugin(extensions?: string[]): Plugin;
export function mergeConfig(base?: Config, override?: Config): Config;
export function loadConfig(
  filename: string,
  cwd?: string,
  fresh?: boolean,
): Promise<Config>;
export function checkBoilerPlate(
  config?: Config,
  onlyConfig?: boolean,
  cwd?: string,
): Promise<void>;
export function runAndWatch(
  script: string,
  args?: string[],
  ignore?: string[],
  extensions?: string[],
  restartDelay?: number,
  options?: object,
): {
  process: import("node:child_process").ChildProcess;
  watcher: import("chokidar").FSWatcher;
  ready: Promise<unknown>;
  close(): Promise<void>;
  restart(filename?: string): void;
};
export function runOnChange(
  command: string,
  args?: string[],
  ignore?: string[],
  extensions?: string[],
  options?: object,
): { close(): Promise<void> };
export function httpGet(
  url: string,
  options?: { timeout?: number; maxBytes?: number; redirects?: number },
): Promise<Buffer>;

export type MobileAction =
  | boolean
  | "stage"
  | "add"
  | "sync"
  | "open"
  | "run"
  | "build"
  | { action: "stage" | "add" | "sync" | "open" }
  | {
      action: "run";
      target?: string;
      flavor?: string;
      scheme?: string;
      configuration?: string;
      liveReload?: boolean;
      connection?: "usb" | "lan" | "emulator" | "simulator";
      host?: string;
    }
  | {
      action: "build";
      flavor?: string;
      scheme?: string;
      configuration?: string;
    };
export interface NativeApp {
  /**
   * Unique app ID, usually your reversed website name plus the app name.
   * @tinybuildOption native.id
   */
  id?: string;

  /**
   * App name shown to people.
   * @tinybuildOption native.name
   */
  name?: string;

  /**
   * Person or team making the app.
   * @tinybuildOption native.author
   */
  author?: string;

  /**
   * Short description included in generated app metadata.
   * @tinybuildOption native.description
   */
  description?: string;

  /**
   * Software license included in generated package metadata.
   * @tinybuildOption native.license
   */
  license?: string;

  /**
   * App version; use three numbers separated by dots.
   * @tinybuildOption native.version
   */
  version?: string;

  /**
   * App-store build counter. Increase it for each uploaded build.
   * @tinybuildOption native.buildNumber
   */
  buildNumber?: number;

  /**
   * Choose one of the profiles above. The CLI can override this with --profile.
   * @tinybuildOption native.profile
   */
  profile?: string;

  /**
   * Named sets of settings for different builds of the same app.
   * @tinybuildOption native.profiles
   */
  profiles?: Record<string, Omit<NativeApp, "profiles" | "profile">>;

  /**
   * Platforms to prepare. Set a platform to false to skip it.
   * @tinybuildOption native.targets
   */
  targets?: Pick<Config, "electron" | "tauri" | "mobile">;

  /**
   * Icon files or asset folders for each platform.
   * @tinybuildOption native.icons
   */
  icons?: { electron?: string; tauri?: string[]; mobile?: string };

  /**
   * Load the live web server inside the app to see saved edits quickly.
   * @tinybuildOption native.devUrl
   */
  devUrl?: string | true;

  /**
   * Your computer's LAN address when another device must reach that server.
   * @tinybuildOption native.devHost
   */
  devHost?: string;

  /**
   * Extra environment variables for native build commands.
   * @tinybuildOption native.env
   */
  env?: Record<string, string>;

  /**
   * Extra native packages to install on a particular platform. Secure storage needs a preset with a plugin provider you choose.
   * @tinybuildOption native.plugins
   */
  plugins?: Array<{
    target?: "mobile" | "electron" | "tauri";
    name: string;
    version?: string;
  }>;

  /**
   * Add common device features and the permissions they need. The app must still ask the person for permission at runtime.
   * @tinybuildOption native.presets
   */
  presets?: Array<
    | "camera"
    | "files"
    | "notifications"
    | {
        name: "camera";
        description?: string;
        photosDescription?: string;
        saveDescription?: string;
      }
    | { name: "secureStorage"; plugin: { name: string; version?: string } }
  >;

  /**
   * Extra platform permissions beyond those supplied by presets.
   * @tinybuildOption native.permissions
   */
  permissions?: {
    android?: string[];
    ios?: Record<string, string>;
    tauri?: string[];
  };
  signing?: { requiredEnv?: string[]; command?: string[]; verify?: string[] };

  /**
   * Additional Capacitor settings merged into the mobile app config.
   * @tinybuildOption native.capacitor
   */
  capacitor?: Record<string, unknown>;

  /**
   * Additional Tauri settings merged into the desktop app config.
   * @tinybuildOption native.tauri
   */
  tauri?: Record<string, unknown>;
}
export function nativeApp(options?: NativeApp): Config;
export function resolveNativeConfig(config: Config): Config;
export function selectNativeProfile(config: Config, profile: string): Config;
export function applyNativePermissions(
  native: NativeApp,
  cwd: string,
): Promise<void>;
export function applyNativeMetadata(
  native: NativeApp,
  cwd: string,
): Promise<void>;
export function prepareNativeConfig(
  config: Config,
  cwd: string,
  options?: { devUrl?: string },
): Promise<
  | {
      directory: string;
      capacitorFile: string;
      tauriFile: string;
      devUrl?: string;
      manualConfig: string[];
    }
  | undefined
>;
export function developmentURLs(
  url: string,
  options?: {
    host?: string;
    interfaces?: ReturnType<typeof import("node:os").networkInterfaces>;
  },
): string[];
export function developmentQR(
  url: string,
  options?: { margin?: number; width?: number },
): Promise<string>;
export interface DeviceReport {
  android: Array<{ id: string; status: string; model?: string }>;
  emulators: string[];
  ios: Array<{ id: string; name: string; state: string; runtime: string }>;
  errors: Array<{ command: string; message: string }>;
}
export function discoverDevices(options?: {
  platform?: string;
  sdk?: string;
  run?: Function;
}): Promise<DeviceReport>;
export interface BuildBudgets {
  /**
   * Maximum combined size of generated files before compression.
   * @tinybuildOption budgets.totalBytes
   */
  totalBytes?: number;

  /**
   * Maximum size of one entry output file before compression.
   * @tinybuildOption budgets.entryBytes
   */
  entryBytes?: number;

  /**
   * Maximum combined size after gzip compression, used for web downloads. This estimates download size; configure compression on your hosting separately.
   * @tinybuildOption budgets.gzipBytes
   */
  gzipBytes?: number;

  /**
   * Maximum combined size after Brotli compression, another download format.
   * @tinybuildOption budgets.brotliBytes
   */
  brotliBytes?: number;

  /**
   * Allowed size increase compared with a previously saved build. Save that build with `tinybuild baseline`; see diagnostics below.
   * @tinybuildOption budgets.growthBytes
   */
  growthBytes?: number;

  /**
   * "error" fails the build if a limit is exceeded; "warn" only tells you. If you leave onExceed out, Tinybuild uses "warn".
   * @tinybuildOption budgets.onExceed
   */
  onExceed?: "warn" | "error";
}
export interface BuildViolation {
  path: string;
  bytes: number;
  limit: number;
}
export interface BuildReport {
  outputBytes: number;
  gzipBytes?: number;
  brotliBytes?: number;
  growthBytes?: number;
  outputs: Array<{
    path: string;
    target: string;
    bytes: number;
    gzipBytes?: number;
    brotliBytes?: number;
    entryPoint?: string | boolean;
    imports: unknown[];
    inputs: Record<string, unknown>;
  }>;
  inputs: Array<{
    path: string;
    bytes: number;
    imports: Array<{ path: string; external: boolean; kind: string }>;
  }>;
  violations: BuildViolation[];
}
export function analyzeBuild(
  results: Bundles,
  options?: {
    cwd?: string;
    budgets?: BuildBudgets;
    compression?: boolean;
    baseline?: string;
  },
): Promise<BuildReport>;
export function benchmarkBuild(
  config: BundlerConfig | BundlerConfig[],
  options?: { iterations?: number; warmup?: number },
): Promise<{
  iterations: number;
  warmup: number;
  cold: BenchmarkSamples;
  warm: BenchmarkSamples;
}>;
export interface BenchmarkSamples {
  samples: number[];
  minMs: number;
  medianMs: number;
  meanMs: number;
}
export interface TaskConfig {
  /**
   * Program to run.
   * @tinybuildOption tasks.command
   */
  command: string;

  /**
   * Arguments passed to that program, one item per argument.
   * @tinybuildOption tasks.args
   */
  args?: string[];

  /**
   * Folder the program runs in, relative to this project.
   * @tinybuildOption tasks.cwd
   */
  cwd?: string;

  /**
   * Extra environment variables passed to the program.
   * @tinybuildOption tasks.env
   */
  env?: Record<string, string>;

  /**
   * Start these tasks first. Stop tasks in the reverse order.
   * @tinybuildOption tasks.dependsOn
   */
  dependsOn?: string[];

  /**
   * "service" stays running; "once" must finish before continuing.
   * @tinybuildOption tasks.mode
   */
  mode?: "once" | "service";

  /**
   * Wait until the program is ready before starting dependent tasks.
   * @tinybuildOption tasks.ready
   */
  ready?: { url?: string; status?: number; stdout?: string; timeout?: number };

  /**
   * Stop this setup task if it takes more than 60 seconds.
   * @tinybuildOption tasks.timeout
   */
  timeout?: number;

  /**
   * Restart this task when these files change.
   * @tinybuildOption tasks.watch
   */
  watch?: string[];

  /**
   * Wait this many milliseconds after the last edit before restarting.
   * @tinybuildOption tasks.delay
   */
  delay?: number;
}
export interface TaskEvent {
  task: string;
  state: string;
  pid?: number;
  code?: number;
  signal?: string;
  message?: string;
}
export interface TaskOptions {
  cwd?: string;
  onEvent?: (event: TaskEvent) => void;
  onError?: (error: Error) => void;
  silent?: boolean;
  signal?: AbortSignal;
  killTimeout?: number;
}
export interface TaskController {
  status: Record<string, Omit<TaskEvent, "task">>;
  restart(name: string): Promise<void>;
  close(): Promise<void>;
}
export function startTasks(
  tasks?: Record<string, TaskConfig>,
  options?: TaskOptions,
): Promise<TaskController>;
export function taskOrder(tasks?: Record<string, TaskConfig>): string[];

export interface ConfigIssue {
  path: string;
  message: string;
}
export interface ConfigValidation {
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
}
export const configOptions: Record<string, string[]>;
export const cliOptions: string[];
export const esbuildOptions: string[];
export function validateConfig(
  config: unknown,
  options?: { strict?: boolean },
): ConfigValidation;
export function assertConfig(
  config: unknown,
  options?: { strict?: boolean; onWarning?: (message: string) => void },
): ConfigValidation;
export function previewConfig(
  config?: Config,
  options?: {
    cwd?: string;
    strict?: boolean;
    sources?: Record<string, string>;
  },
): {
  cwd: string;
  config: unknown;
  server: unknown;
  outputs: unknown[];
  watch: string[];
  copy: unknown;
  tasks: string[];
  native: unknown[];
  validation: ConfigValidation;
  explanations: Array<{ path: string; source: string; reason: string }>;
  note: string;
};
export function mobileDevelopment(config: Config): Config;
export function mobileRunOptions(
  platform: "android" | "ios",
  settings: {
    liveReload?: boolean;
    connection?: "usb" | "lan" | "emulator" | "simulator";
    host?: string;
  },
  serverURL?: string,
): string[];
export function nativePresets(presets?: NativeApp["presets"]): {
  plugins: NonNullable<NativeApp["plugins"]>;
  permissions: NonNullable<NativeApp["permissions"]>;
};
export function inside(root: string, file: string): boolean;
export function recordOutputs(
  files: string[],
  options?: { cwd?: string; kind?: string },
): Promise<void>;
export function cleanGenerated(options?: {
  cwd?: string;
  dryRun?: boolean;
  kind?: string;
  keep?: string[];
}): Promise<{ dryRun: boolean; removed: string[]; preserved: string[] }>;
export function copyAssets(
  definitions?: Config["copy"],
  options?: { cwd?: string },
): Promise<{ files: string[]; metafile: import("esbuild").Metafile }>;
export function saveBaseline(
  report: BuildReport,
  filename: string,
  options?: { cwd?: string },
): Promise<string>;
export function writeBuildReport(
  report: BuildReport,
  filename: string,
  options?: { cwd?: string },
): Promise<string>;
export function smokeMobile(options: {
  platform: "android" | "ios";
  id: string;
  artifact: string;
  device: string;
  activity?: string;
  dryRun?: boolean;
  hostPlatform?: string;
  sdk?: string;
  timeout?: number;
  signal?: AbortSignal;
  run?: Function;
}): Promise<{
  platform: string;
  id: string;
  device: string;
  commands: Array<[string, string[]]>;
  dryRun: boolean;
  pid?: string;
}>;

export interface RemoteConfig {
  host: string;
  directory?: string;
  platform?: "posix" | "windows";
  command?: string[] | false;
  forwards?: Array<{ local: number; remote: number }>;
  port?: number;
  identityFile?: string;
  ready?: { url: string; timeout?: number };
}
export interface RemotePlan {
  command: string;
  args: string[];
  ready?: RemoteConfig["ready"];
  urls: string[];
  note: string;
}
export function remotePlan(config: RemoteConfig): RemotePlan;
export function startRemote(
  config: RemoteConfig,
  options?: TaskOptions & { dryRun?: boolean; supervise?: typeof startTasks },
): Promise<
  RemotePlan & {
    dryRun?: boolean;
    tasks?: TaskController;
    close?: () => Promise<void>;
  }
>;
export function serverRoot(config?: ServerConfig, cwd?: string): string;
export function browserURL(url: string, page?: true | string): string;
export function openBrowser(
  url: string,
  options?: { platform?: string; run?: Function },
): Promise<string>;
export function loadEnvironment(
  files: string | string[],
  options?: { cwd?: string; env?: Record<string, string | undefined> },
): Promise<{ files: string[]; keys: string[] }>;
export function probeServer(
  url: string,
  options?: { timeout?: number; signal?: AbortSignal; request?: typeof fetch },
): Promise<{
  url: string;
  ready: boolean;
  status: number | null;
  durationMs: number;
  error?: string;
}>;
export function staticCacheControl(
  config: ServerConfig,
  pathname: string,
  filename: string,
): string;
export function validateServerTools(config?: ServerConfig): void;
export function macReleasePlan(filename: string): Array<[string, string[]]>;
export function verifyMacRelease(
  filename: string,
  options?: {
    platform?: string;
    dryRun?: boolean;
    signal?: AbortSignal;
    run?: Function;
  },
): Promise<{
  file: string;
  commands: Array<[string, string[]]>;
  verified: boolean;
  dryRun: boolean;
}>;
export function notarizeMac(options: {
  archive: string;
  application?: string;
  keychainProfile: string;
  platform?: string;
  dryRun?: boolean;
  timeout?: number;
  signal?: AbortSignal;
  run?: Function;
}): Promise<{
  file: string;
  commands: Array<[string, string[]]>;
  verified: boolean;
  dryRun: boolean;
  submissionId?: string;
}>;
export interface MobileCheckpoint {
  phase:
    | "launched"
    | "permission"
    | "relaunched"
    | "disconnected"
    | "reconnected"
    | "backgrounded"
    | "resumed";
  permission?: string;
  granted?: boolean;
  iteration?: number;
}
export function checkMobileLifecycle(
  options: Parameters<typeof smokeMobile>[0] & {
    permissions?: string[];
    relaunches?: number;
    reconnectPort?: number;
    disconnectDelay?: number;
    backgrounds?: number;
    backgroundDelay?: number;
    verify?: (checkpoint: MobileCheckpoint) => void | Promise<void>;
  },
): Promise<
  Awaited<ReturnType<typeof smokeMobile>> & {
    checkpoints: MobileCheckpoint[];
    checked: boolean;
  }
>;

export function writeConfigEdits(
  filename: string,
  edits: Partial<Config>,
  options?: { cwd?: string; dryRun?: boolean; expectedSource?: string | null },
): Promise<{ filename: string; source: string; backup?: string }>;
export function configure(options?: {
  cwd?: string;
  filename?: string;
  edits?: Partial<Config>;
  yes?: boolean;
  dryRun?: boolean;
  question?: (prompt: string) => Promise<string>;
  log?: (message: string) => void;
}): Promise<
  { cancelled: true } | { filename: string; source: string; backup?: string }
>;
export interface DesktopWindow {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  title?: string;
  backgroundColor?: string;
  resizable?: boolean;
  maximizable?: boolean;
  fullscreen?: boolean;
}
export interface NativeResult {
  stages: Partial<
    Record<
      "electron" | "tauri" | "mobile",
      { directory: string; html: string; files: string[] }
    >
  >;
  commands: string[][];
  invocations: Array<{ args: string[]; cwd: string }>;
  artifactDirectories: string[];
  /** Current immediate directory contents after packaging; older files may also be present. */
  artifacts: Array<{
    directory: string;
    exists: boolean;
    entries: Array<{ path: string; type: "file" | "directory" }>;
  }>;
  watched: { electron?: string[] };
  close(): Promise<void>;
  config: Awaited<ReturnType<typeof prepareNativeConfig>>;
}
export function desktopDevelopment(config: Config): Config;
export function electronLaunchOptions(
  options?: Extract<Config["electron"], object>,
): {
  flags: string[];
  args: string[];
  window: DesktopWindow;
  devtools: boolean;
};
export function tauriCommand(
  options?: Extract<Config["tauri"], object>,
  configFile?: string,
): string[];
