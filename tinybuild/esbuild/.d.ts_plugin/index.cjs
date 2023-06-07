var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __markAsModule = (target) => __defProp(target, "__esModule", { value: true });
var __export = (target, all) => {
  __markAsModule(target);
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __reExport = (target, module2, desc) => {
  if (module2 && typeof module2 === "object" || typeof module2 === "function") {
    for (let key of __getOwnPropNames(module2))
      if (!__hasOwnProp.call(target, key) && key !== "default")
        __defProp(target, key, { get: () => module2[key], enumerable: !(desc = __getOwnPropDesc(module2, key)) || desc.enumerable });
  }
  return target;
};
var __toModule = (module2) => {
  return __reExport(__markAsModule(__defProp(module2 != null ? __create(__getProtoOf(module2)) : {}, "default", module2 && module2.__esModule && "default" in module2 ? { get: () => module2.default, enumerable: true } : { value: module2, enumerable: true })), module2);
};

// src/index.ts
__export(exports, {
  dtsPlugin: () => dtsPlugin,
  util: () => util
});

// src/config.ts
var import_typescript = __toModule(require("typescript"));
var import_fs = __toModule(require("fs"));
// src/plugin.ts
var import_path = __toModule(require("path"));

const getTemplate =  (entryFile='index.js') => {
  return `{
    "include": ["${entryFile}"],
    "compilerOptions": {
      /* Visit https://aka.ms/tsconfig.json to read more about this file */
      /* Basic Options */
      // "incremental": true,                   /* Enable incremental compilation */
      "target": "ESNEXT" /* Specify ECMAScript target version: 'ES3' (default), 'ES5', 'ES2015', 'ES2016', 'ES2017', 'ES2018', 'ES2019', 'ES2020', or 'ESNEXT'. */,
      "module": "ESNEXT" /* Specify module code generation: 'none', 'commonjs', 'amd', 'system', 'umd', 'es2015', 'es2020', or 'ESNext'. */,
      "declaration": true,                      /* Generates corresponding '.d.ts' file. */
      "allowJs": true,                       /* Allow javascript files to be compiled. */
      "skipLibCheck": true /* Skip type checking of declaration files. */,
      "forceConsistentCasingInFileNames": true /* Disallow inconsistently-cased references to the same file. */,
      "outDir": "./dist" /* Redirect output structure to the directory. */,
      "strict": true /* Enable all strict type-checking options. */,
      "esModuleInterop": true /* Enables emit interoperability between CommonJS and ES Modules via creation of namespace objects for all imports. Implies 'allowSyntheticDefaultImports'. */,
      // "checkJs": true,                       /* Report errors in .js files. */
      // "jsx": "preserve",                     /* Specify JSX code generation: 'preserve', 'react-native', or 'react'. */
      // "lib": [],                             /* Specify library files to be included in the compilation. */  
      // "declarationMap": true,                /* Generates a sourcemap for each corresponding '.d.ts' file. */
      // "sourceMap": true,                     /* Generates corresponding '.map' file. */
      // "outFile": "./",                       /* Concatenate and emit output to single file. */
      // "rootDir": "./",                       /* Specify the root directory of input files. Use to control the output directory structure with --outDir. */
      // "composite": true,                     /* Enable project compilation */
      // "tsBuildInfoFile": "./",               /* Specify file to store incremental compilation information */
      // "removeComments": true,                /* Do not emit comments to output. */
      // "noEmit": true,                        /* Do not emit outputs. */
      // "importHelpers": true,                 /* Import emit helpers from 'tslib'. */
      // "downlevelIteration": true,            /* Provide full support for iterables in 'for-of', spread, and destructuring when targeting 'ES5' or 'ES3'. */
      // "isolatedModules": true,               /* Transpile each file as a separate module (similar to 'ts.transpileModule'). */
      /* Strict Type-Checking Options */
      // "noImplicitAny": true,                 /* Raise error on expressions and declarations with an implied 'any' type. */
      // "strictNullChecks": true,              /* Enable strict null checks. */
      // "strictFunctionTypes": true,           /* Enable strict checking of function types. */
      // "strictBindCallApply": true,           /* Enable strict 'bind', 'call', and 'apply' methods on functions. */
      // "strictPropertyInitialization": true,  /* Enable strict checking of property initialization in classes. */
      // "noImplicitThis": true,                /* Raise error on 'this' expressions with an implied 'any' type. */
      // "alwaysStrict": true,                  /* Parse in strict mode and emit "use strict" for each source file. */
      /* Additional Checks */
      // "noUnusedLocals": true,                /* Report errors on unused locals. */
      // "noUnusedParameters": true,            /* Report errors on unused parameters. */
      // "noImplicitReturns": true,             /* Report error when not all code paths in function return a value. */
      // "noFallthroughCasesInSwitch": true,    /* Report errors for fallthrough cases in switch statement. */
      /* Module Resolution Options */
      // "moduleResolution": "node",            /* Specify module resolution strategy: 'node' (Node.js) or 'classic' (TypeScript pre-1.6). */
      // "baseUrl": "./",                       /* Base directory to resolve non-absolute module names. */
      // "paths": {},                           /* A series of entries which re-map imports to lookup locations relative to the 'baseUrl'. */
      // "rootDirs": [],                        /* List of root folders whose combined content represents the structure of the project at runtime. */
      // "typeRoots": [],                       /* List of folders to include type definitions from. */
      // "types": [],                           /* Type declaration files to be included in compilation. */
      // "allowSyntheticDefaultImports": true,  /* Allow default imports from modules with no default export. This does not affect code emit, just typechecking. */
      // "preserveSymlinks": true,              /* Do not resolve the real path of symlinks. */
      // "allowUmdGlobalAccess": true,          /* Allow accessing UMD globals from modules. */
      /* Source Map Options */
      // "sourceRoot": "",                      /* Specify the location where debugger should locate TypeScript files instead of source locations. */
      // "mapRoot": "",                         /* Specify the location where debugger should locate map files instead of generated locations. */
      // "inlineSourceMap": true,               /* Emit a single file with source maps instead of having a separate file. */
      // "inlineSources": true,                 /* Emit the source alongside the sourcemaps within a single file; requires '--inlineSourceMap' or '--sourceMap' to be set. */
      /* Experimental Options */
      // "experimentalDecorators": true,        /* Enables experimental support for ES7 decorators. */
      // "emitDecoratorMetadata": true,         /* Enables experimental support for emitting type metadata for decorators. */
      /* Advanced Options */
      //"resolveJsonModule": true
    }
  }
`
}

const tsconfigTemplate = ()=>{return getTemplate();}

const tsconfig = (location, content=tsconfigTemplate) => {
  if(typeof content === 'function') content = content();
  import_fs.writeFileSync(import_path.join(process.cwd(),'tsconfig.json'), content)
}

function getTSConfig(forcepath, conf, wd = process.cwd(), retry = false) {
  let f = forcepath != null ? forcepath : import_typescript.default.findConfigFile(wd, import_typescript.default.sys.fileExists, conf);
  //console.log(f);
  if(!f && retry) {
    throw "No config file found";
  }
  else if (!f) { //console.log('writing tsconfig to', process.cwd());
    tsconfig(process.cwd())
    return getTSConfig(forcepath, conf, wd, true); //retry
  }//throw "No config file found";
  if (f.startsWith("."))
    f = require.resolve(f);
  const c = import_typescript.default.readConfigFile(f, (path) => (0, import_fs.readFileSync)(path, "utf-8"));
  if (c.error)
    throw c.error;
  else
    return { loc: f, conf: c.config };
}

// src/plugin.ts
var import_typescript2 = __toModule(require("typescript"));
var import_fs2 = __toModule(require("fs"));
//var import_chalk = __toModule(require("chalk"));

// src/util.ts
function getLogLevel(level) {
  if (!level || level === "silent")
    return ["silent"];
  const levels = ["verbose", "debug", "info", "warning", "error", "silent"];
  for (const l of levels) {
    if (l === level) {
      break;
    } else {
      levels.splice(levels.indexOf(l), 1);
    }
  }
  return levels;
}
function humanFileSize(size) {
  const i = Math.floor(Math.log(size) / Math.log(1024));
  return Math.round(size / Math.pow(1024, i) * 100) / 100 + ["b", "kb", "mb", "gb", "tb"][i];
}

//var import_tmp = __toModule(require("tmp"));
var dtsPlugin = (opts = {}) => ({
  name: "dts-plugin",
  async setup(build) {
    var _a, _b, _c;
    const l = getLogLevel(build.initialOptions.logLevel);
    const conf = getTSConfig(opts.tsconfig);
    const finalconf = conf.conf;
    if (Object.prototype.hasOwnProperty.call(conf.conf, "extends")) {
      const extendedfile = (0, import_fs2.readFileSync)((0, import_path.resolve)((0, import_path.dirname)(conf.loc), conf.conf.extends), "utf-8");
      const extended = (0, JSON.parse)(extendedfile);
      if (Object.prototype.hasOwnProperty.call(extended, "compilerOptions") && Object.prototype.hasOwnProperty.call(finalconf, "compilerOptions")) {
        finalconf.compilerOptions = __spreadValues(__spreadValues({}, extended.compilerOptions), finalconf.compilerOptions);
      }
    }

    const copts = import_typescript2.default.convertCompilerOptionsFromJson(finalconf.compilerOptions, process.cwd()).options;
    //console.log(conf,copts);
    copts.declaration = true;
    copts.emitDeclarationOnly = true;
    copts.incremental = true;
    if (!copts.declarationDir)
      copts.declarationDir = (_b = (_a = opts.outDir) != null ? _a : build.initialOptions.outdir) != null ? _b : copts.outDir;
    //const pjloc = (0, import_path.resolve)(conf.loc, "../", "package.json");
    // if ((0, import_fs2.existsSync)(pjloc)) { //?
    //   copts.tsBuildInfoFile = (0, import_path.resolve)(import_tmp.tmpdir, (_c = require(pjloc).name) != null ? _c : "unnamed", ".esbuild", ".tsbuildinfo");
    // }
    copts.listEmittedFiles = true;
    const host = import_typescript2.default.createIncrementalCompilerHost(copts);
    const files = [];
    build.onLoad({ filter: /(\.tsx|\.ts|\.js|\.jsx)$/ }, async (args) => {
      var _a2;
      files.push(args.path);
      host.getSourceFile(args.path, (_a2 = copts.target) != null ? _a2 : import_typescript2.default.ScriptTarget.Latest, (m) => console.log(m), true);
      return {};
    });
    build.onEnd(() => {
      const finalprogram = import_typescript2.default.createIncrementalProgram({
        options: copts,
        host,
        rootNames: files
      });
      const start = Date.now();
      const emit = finalprogram.emit();
      let final = "";
      if (emit.emitSkipped || typeof emit.emittedFiles === "undefined") {
        // if (l.includes("warning"))
        //   console.log(`Typescript did not emit anything`);
      } else {
        for (const emitted of emit.emittedFiles) {
          if ((0, import_fs2.existsSync)(emitted) && !emitted.endsWith(".tsbuildinfo")) {
            const stat = (0, import_fs2.lstatSync)(emitted);
            final +=`  ${(0, import_path.resolve)(emitted).replace((0, import_path.resolve)(process.cwd()), "").replace(/^[\\/]/, "").replace((0, import_path.basename)(emitted), `${(0, import_path.basename)(emitted)}`)} ${humanFileSize(stat.size)}\n`;
          }
        }
      }
      if (l.includes("info"))
        console.log(final + `\ngreen Finished compiling declarations in ${Date.now() - start}ms`);
    });
  }
});

// src/index.ts
var util = {
  humanFileSize,
  getLogLevel,
  getTSConfig
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  dtsPlugin,
  util
});
//# sourceMappingURL=index.js.map