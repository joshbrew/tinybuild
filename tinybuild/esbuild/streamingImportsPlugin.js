import fs from 'fs';
import path from 'path';

// NOTE: Will be thrown by comments, but is not catastrophic
const re = /import([ \n\t]*(?:(?:\* (?:as .+))|(?:[^ \n\t\{\}]+[ \n\t]*,?)|(?:[ \n\t]*\{(?:[ \n\t]*[^ \n\t"'\{\}]+[ \n\t]*,?)+\}))[ \n\t]*)from[ \n\t]*(['"])([^'"\n]+)(?:['"])([ \n\t]*assert[ \n\t]*{type:[ \n\t]*(['"])([^'"\n]+)(?:['"])})?/g;

// Simple function to remove invalid Windows filename characters
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '-');
}

const handleImport = async (pathStr, tryFileExtension = true) => {
  // Use the URL constructor for easier parsing and to remove query params from the filename
  const urlObj = new URL(pathStr);
  const rawName = path.basename(urlObj.pathname) || 'index';
  // Decide on extension: if the URL is from fonts.googleapis.com, use .css (adjust as needed)
  const ext = path.extname(urlObj.pathname) || (pathStr.includes('font') ? '.css' : '.js');
  // Create a safe filename with the extension
  const safeFilename = sanitizeFilename(rawName) + ext;

  // Build cache directory based on URL host for better organization
  const cacheDir = path.join(process.cwd(), 'node_modules', '.cache', urlObj.host);

  // Create the directory if it doesn't exist already
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  let cachepath = path.join(cacheDir, safeFilename);

  if (!fs.existsSync(cachepath)) {
    const pathPrefix = urlObj.protocol + "//";
    // Reconstruct the fetch URL (include the search params so you get the correct file)
    const fetchPath = pathPrefix + path.join(urlObj.host, urlObj.pathname) + urlObj.search;

    console.time('Caching import at ' + cachepath);
    let text = await httpGet(fetchPath).then(async (buffer) => {
      const text = buffer.toString('utf-8');
      if (!text.includes("Couldn't find the requested file")) {
        return text;
      } else {
        const fileExtensionPath =
          urlObj.protocol +
          "//" +
          path.join(urlObj.host, path.dirname(urlObj.pathname), rawName, 'index.js');
        if (tryFileExtension) {
          const { cachepath, text } = await handleImport(fileExtensionPath, false);
          return text;
        } else {
          console.error('Could not find file', fileExtensionPath);
          return;
        }
      }
    });

    if (text) {
      let textCopy = text;
      let m;
      do {
        m = re.exec(textCopy);
        if (m == null) m = re.exec(textCopy); // be extra sure (weird bug)
        if (m) {
          console.log('found', m[0]);
          textCopy = textCopy.replace(m[0], ``); // Replace found text in checked string
          const importPath = m[3];
          // Only cache JS files
          if (importPath.slice(-2) === 'js') {
            const updatedPath =
              urlObj.protocol +
              '//' +
              path.join(urlObj.host, path.dirname(urlObj.pathname), importPath);
            await handleImport(updatedPath);
          } else break; // abort further imports. TODO: Check whether we can 
        }
      } while (m);

      fs.writeFileSync(cachepath, text); // Cache the fetched file
      console.timeEnd('Caching import at ' + cachepath);
    }
  }

  return {
    cachepath,
  };
};

export const streamingImportsPlugin = {
  name: 'streamImports',
  setup(build) {
    // Handle all import/require paths starting with "http://" or "https://"
    build.onResolve({ filter: /^https?:\/\// }, async (args) => {
      if (args.kind?.includes('import') || args.kind?.includes('require')) {
        const { cachepath } = await handleImport(args.path);
        return { path: cachepath };
      }
    });
  }
};

import http from 'http';
import https from 'https';

// Custom plugin to resolve HTTP imports
export function httpGet(url) {
  return new Promise((resolve, reject) => {
    let client = http;

    if (url.startsWith("https")) {
      client = https;
    }

    client.get(url, (resp) => {
      let chunks = [];

      // A chunk of data has been received.
      resp.on('data', (chunk) => {
        chunks.push(chunk);
      });

      // The whole response has been received. Print out the result.
      resp.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    }).on("error", (err) => {
      reject(err);
    });
  });
}
