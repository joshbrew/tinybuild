import { json } from "./utils.js"

export const server = {
    'debug': json, // debug?
    'socket_protocol': json, //node server socket protocol (wss for hosted, or ws for localhost, depends)
    'pwa': json, //pwa service worker relative path
    'hotreload':  json, //pwa service worker relative path
    'delay': json,
    'hotreloadExtensions':json,
    'redirect': json,
    'reloadscripts':json,
    'keypath': json, //https key path
    'certpath': json, //https cert path
    'watch': json, //pwa service worker relative path
    'ignore': json, //pwa service worker relative path
    'extensions': json, //pwa service worker relative path
    'python': json, // python port
    'host': json, // node host
    'port': json, // node port
    'protocol': json, // node http or https protocols
    'startpage': json, // html page to start your app
}