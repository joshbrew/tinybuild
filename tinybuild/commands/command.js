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
    args=process.argv, 
    callback=(k, v) => {
        accumulator[k] = v;
    }, 
    accumulator={}
) => {
    const argMap = get(args);

    let notFound = Object.assign({}, argMap);

    // Check Prefixed Commands
    commandMap.forEach(o => {
        if (o.name in argMap) {
            const res = o.transformation(argMap[o.name], accumulator)
            callback(o.name, res);
            delete notFound[o.name];
        } 
    })

    // Check Bare Commands
    for (let name in commands.bare){
        const o = commands.bare[name]
        if (name in argMap) {
            if (o?.not) {
                const hasNot = o.not.find(str => str in argMap)
                if (!hasNot) {
                    callback(name, true);
                    delete notFound[o.name];
                }
            } else {
                callback(name, true);
                delete notFound[o.name];
            }
        }
    }

    //non hard-coded commands
    for(const name in notFound) {
        let res = notFound[name];
        if(typeof res === 'string') res = JSON.parse(res);
        callback(name, notFound[name]);
    }


    return accumulator
}