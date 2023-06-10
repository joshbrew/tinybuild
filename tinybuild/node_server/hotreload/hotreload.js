
import WebSocket from 'ws'
import {WebSocketServer} from 'ws'
import path from 'path'
import chokidar from 'chokidar' //for hot swapping modules in the dist

export class HotReload {
  config = null;
  wss = null;
  url = null;

  constructor (cfg, BUILD_PROCESS){
    this.config = cfg
    this.wss = new WebSocketServer({ // new WebSocket.Server({
      port: cfg.hotreload
    });

    this.url = `${cfg.socket_protocol}://${cfg.host}:${cfg.port}/hotreload`;

    this.wss.on('error',(err)=>{
      console.error('hotreload wss error:',err);
    })

    let sockets = {};
    let ct = 0;

    //console.log(cfg);

    if(cfg.hotreloadwatch && BUILD_PROCESS) {
       //putting a watch on files for sending messages to trigger hot module replacement (the cheap version)
      let watcher = chokidar.watch(
        '', {
        ignored: /^(?:.*[\\\\\\/])?node_modules(?:[\\\\\\/].*)?|(?:.*[\\\\\\/])?.git(?:[\\\\\\/].*)?|(?:.*[\\\\\\/])?android(?:[\\\\\\/].*)?|(?:.*[\\\\\\/])?ios(?:[\\\\\\/].*)?$/, // ignore node_modules
          persistent: true,
          ignoreInitial:true,
          interval:15,
          binaryInterval:200
      });
      

      let jschanged = false;
      let csschanged = false;
      let outfilesplit = cfg.hotreloadoutfile.split(path.sep);
      
      let watchBuffer = [];

      function iterateWatchBuffer() {
        setTimeout(()=>{
          watchBuffer.forEach((p) => {
            let found = cfg.hotreloadwatch.find((v) => { if(p.split(path.sep).join('/').includes(v)) return true; });
            let isMainJS = p.includes(outfilesplit);
            let isJS = p.endsWith('js') || p.endsWith('ts') || p.endsWith('jsx') || p.endsWith('tsx');
            let isCSS = p.endsWith('css') || p.endsWith('sass');
  
            //css and js will change in main repo before updating in dist so we can do this check to prevent reduncancies
            //console.log(p, found, isCSS, csschanged);
            if(found && ((isMainJS && jschanged) || (isCSS && csschanged))) { //for the dist folder, don't reload the js or css unless it was found to have changed
  
              console.log("Server updated: "+`${cfg.protocol}://${cfg.host}:${cfg.port}/`);
            
              for(const key in sockets) {
                sockets[key].send(JSON.stringify({file:p, reloadscripts:cfg.reloadscripts}));
              }
            
              if(isJS) jschanged = false;
              else if(isCSS) csschanged = false;
            
            } else if(!found) {
              if(isJS) {
                jschanged = true;
              }
              else if (isCSS) {
                csschanged = true;
              } 
              else {
                console.log("Server updated: "+`${cfg.protocol}://${cfg.host}:${cfg.port}/`);
              
                for(const key in sockets) {
                  sockets[key].send(JSON.stringify({file:p, reloadscripts:cfg.reloadscripts}));
                }
              }  
            }
          });
        
          watchBuffer.length = 0;   
        }, 20);
      }

      
      watcher.on('change',(filepath,stats)=>{
        let pass = true;
        pass = !filepath.includes('worker.js');
        if(pass) watchBuffer.push(filepath);
          
        if(!BUILD_PROCESS.process.listenerSet) { //the build process gets swapped each time it resets
          BUILD_PROCESS.process.listenerSet = true;
          BUILD_PROCESS.process.stdout.addListener('data', (data) => {
            let message = data.toString();
            if(message.includes('Packager finished')) {
              iterateWatchBuffer()            
            }
          });
        }

      });
    }
   
    this.wss.on('connection', (ws) => {
      //ws.send(something);
    
      if(cfg.debug) console.log('New Connection to Hot Reload socket!');
    
      ws.on('message', function message(data) {
          console.log('received: %s', data); //log messages from client
      });
    
      ws.send(`${this.url}: pong!`);
    
      sockets[ct] = ws; //for multiple tabs 

      ct++;

      ws.on('close', () => {
        delete sockets[ct];
      });
    });

  }

  add = (content) => {
    if(typeof content !== 'string') content = content.toString();
    return `${content}\n\n<script> console.log('Hot Reload port available at ${this.url}');  (`+HotReloadClient.toString()+`)('${this.url}','${cfg.hotreloadoutfile}')  </script>`;
  }
}

export function addHotReloadClient(content, socketUrl, esbuild_cssFileName) {
  if(typeof content !== 'string') content = content.toString();
  return `${content}\n\n<script> console.log('Hot Reload port available at ${socketUrl}');  (`+HotReloadClient.toString()+`)('${socketUrl}', '${esbuild_cssFileName}')  </script>`;
}

//frontend (browser) js function to be stringified, injected, and executed in-browser
export const HotReloadClient = (socketUrl, esbuild_cssFileName) => {
    //hot reload code injected from backend
    //const socketUrl = `ws://${cfg.host}:${cfg.hotreload}`;
    let socket = new WebSocket(socketUrl);


    function reloadLink(file) {

      let split = file.includes('/') ? file.split('/') : file.split('\\');
      let fname = split[split.length-1];

      var links = document.getElementsByTagName("link");
      for (var cl in links)
      {
          var link = links[cl];

          if(!file || link.href?.includes(fname)) {
            let href = link.getAttribute('href')
                                            .split('?')[0];
                      
            let newHref = href + "";

            link.setAttribute('href', newHref);
            console.log('Updated', link.rel, link.href);
          }
      }
    }


    function reloadAsset(file, reloadscripts) { //reloads src tag elements
      let split = file.includes('/') ? file.split('/') : file.split('\\');
      let fname = split[split.length-1];
      let elements = document.querySelectorAll('[src]');
      let found = false;
      for(const s of elements) {
        if(s.src.includes(fname)) { //esbuild compiles entire file so just reload app
          if(s.tagName === 'SCRIPT' && !reloadscripts) {//&& s.tagName === 'SCRIPT'
            window.location.reload();
            return;
          } else {
            let placeholder = document.createElement('object');
            s.insertAdjacentElement('afterend', placeholder);
            s.remove();
            let elm = s.cloneNode(true);
            placeholder.insertAdjacentElement('beforebegin',elm);
            placeholder.remove();
            found = true;
          }
        }
      }

      //if(!found) window.location.reload(); //just do a page reload if nothing specific was found (?)
    }

    socket.addEventListener('message',(ev) => {
      let message = ev.data;

      if(typeof message === 'string' && message.startsWith('{')) {
        message = JSON.parse(message);
      }
      if(message.file) {
        let f = message.file;
        let rs = message.reloadscripts;
        if(f.endsWith('html') || f.endsWith('xml') || f.endsWith('wasm')) { //could add other formats
          window.location.reload();
        } else if(f.endsWith('css')) {
          if(!esbuild_cssFileName.endsWith('css')) esbuild_cssFileName += '.css';
          reloadLink(esbuild_cssFileName); //reload all css since esbuild typically bundles one file same name as the dist file
        } else if (f.endsWith('js') || f.endsWith('ts') || f.endsWith('jsx') || f.endsWith('tsx') || f.endsWith('vue')) { //IDK what other third party formats would be nice to haves
          reloadAsset(f, rs);
        } else {
          //could be an href or src
          reloadLink(f);
          reloadAsset(f);
        }
      }
    });


    socket.addEventListener('close',()=>{
      // Then the server has been turned off,
      // either due to file-change-triggered reboot,
      // or to truly being turned off.
  
      // Attempt to re-establish a connection until it works,
      // failing after a few seconds (at that point things are likely
      // turned off/permanantly broken instead of rebooting)
      const interAttemptTimeoutMilliseconds = 100;
      const maxDisconnectedTimeMilliseconds = 3000;
      const maxAttempts = Math.round(maxDisconnectedTimeMilliseconds/interAttemptTimeoutMilliseconds);
      let attempts = 0;
      const reloadIfCanConnect = ()=>{
        attempts ++ ;
        if(attempts > maxAttempts){
          console.error("Could not reconnect to dev server.");
          return;
        }
        socket = new WebSocket(socketUrl);
        socket.onerror = (er) => {
          console.error(`Hot reload port disconnected, will reload on reconnected. Attempt ${attempts} of ${maxAttempts}`);
        }
        socket.addEventListener('error',()=>{
          setTimeout(reloadIfCanConnect,interAttemptTimeoutMilliseconds);
        });
        socket.addEventListener('open',()=>{
          location.reload();
        });
      };
      reloadIfCanConnect();
    });
}

// exports.hotreload = hotreload;
// exports.socketUrl = socketUrl;
// exports.addhotload = addhotreload;
// exports.hotreloadclient = hotreloadclient;

