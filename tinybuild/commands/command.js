import * as commands from './index.js'

//why is this so complicated

export const set = (name, transformation=(v) => v) => {
    commandMap.set(name, {
        transformation,
        name
    })
}

const commandMap = new Map()
const commandSets = [commands.basic, commands.server, commands.bundler]

commandSets.forEach(commandSet => {
    for (let name in commandSet) set(name, commandSet[name])
});

export const get = (args=process.argv) => {
    const argMap = {}
    args.forEach((v,i) => {

        if (v.startsWith('--')) {
            const key = v.replaceAll('-', '').trim()
            if(!args[i+1].startsWith('--') && !args[i+1].includes('=')) 
                argMap[key] = args[i+1]; //assumes next non-command arg is a value when using dashes
        } 
        else if (v.includes('=')) {
            let split = v.split('=');
            const key = split[0];
            argMap[key] = split[1];
        }
        else argMap[v] = true;
    })

    return argMap;
}



export const check = (
    args=process.argv
) => {
    const argMap = get(args);

    let notFound = Object.assign({}, argMap);
    
    const argResults = {};
    // Check Prefixed Commands
    for(const key in argMap) {
        for(const commands of commandSets) {
            if(key in commands) {
                if(typeof commands[key] === 'function') {
                    argResults[key] = commands[key](argMap[key], argResults);
                } 
                else if(typeof argMap[key] !== undefined) argResults[key] = argMap[key];
                else argResults[key] = true;
                delete notFound[key];
            }
        }
    }

    //non hard-coded commands
    for(const name in notFound) {
        let res = notFound[name];
        argResults[name] = res;
    }

    return argResults;
}



export function parseArgs(args=process.argv) {
    
    let tcfg = {
        server:{},
        bundler:{}
    }

    let argMap = check(args);
    for(const key in argMap) {
        if (key in commands.server) tcfg.server[key] = argMap[key];
        else if (key in commands.bundler) tcfg.bundler[key] = argMap[key];
        else tcfg[key] = argMap[key];
    }

    if(tcfg.server) if(Object.keys(tcfg.server).length === 0) delete tcfg.server;
    if(tcfg.bundler) if(Object.keys(tcfg.bundler).length === 0) delete tcfg.bundler; 

    return tcfg;
}