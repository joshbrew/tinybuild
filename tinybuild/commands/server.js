import { json } from "./utils.js"

export const server = {
    'debug': json, // debug?
    'socket_protocol': undefined, //node server socket protocol (wss for hosted, or ws for localhost, depends)
    'pwa': undefined, //pwa service worker relative path
    'hotreload':  undefined, //pwa service worker relative path
    'redirect': undefined,
    'reloadscripts':undefined,
    'keypath': undefined, //https key path
    'certpath': undefined, //https cert path
    'watch': undefined, //pwa service worker relative path
    'ignore': undefined, //pwa service worker relative path
    'extensions': undefined, //pwa service worker relative path
    'python': undefined, // python port
    'host': undefined, // node host
    'port': undefined, // node port
    'protocol': undefined, // node http or https protocols
    'startpage': undefined, // html page to start your app
}