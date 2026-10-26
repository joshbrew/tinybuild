// Stylesheets are bundled by esbuild, rather than loaded as JavaScript modules.
// This declaration lets TypeScript check `import './style.css'` in app code.
declare module "*.css" {}

// Add declarations for other file types you import, matching bundler.loader.
// For a loader that returns a URL or text, a declaration can look like this:
// declare module "*.svg" {
//   const value: string;
//   export default value;
// }
