import help from "./help.js"

export const basic = {
    'help': help,
    'path': undefined, //path to the tinybuild script where the packager or plain bundler etc. are being run. defaults to look for 'tinybuild.js'
    'bundleCore': (input, accumulator) => {
        accumulator.includeCore = input
        return null
    },
    'script': (input, accumulator) => {
        accumulator.initScript =  decodeURIComponent(input);  //encoded URI string of a javascript file
        return null
    },
    'config': (input, accumulator) => {
        Object.assign(accumulator, JSON.parse(input)); //encoded URI string of a packager config.
        return null
    },
    'GLOBAL':undefined
}