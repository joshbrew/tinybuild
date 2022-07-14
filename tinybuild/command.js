import * as commands from './commands/index.js'

const commandMap = new Map()
const commandSets = [commands.basic, commands.server, commands.bundler]
commandSets.forEach(set => {
    for ( let name in set) commandMap.set(name, set[name])
})

export const get = (args=process.argv) => {
    const argMap = {}
    const reversedArgv = args
    reversedArgv.forEach((v,i) => {
        if (v.includes('-')) {
            const key = v.replaceAll('-', '').trim()
            argMap[key] = reversedArgv[i+1]
        } 
        else if (Object.keys(commands.bare).includes(v)) {
            argMap[v] = true
        }
    })

    return argMap
}

export const set = (name, o) => {
    if (!o.transformation) o.transformation = (v) => v
    commandMap.set(name, o)
}


export const check = (args=process.argv, callback, accumulator={}) => {
    const argMap = get(args)

    // Check Prefixed Commands
    commandMap.forEach(o => {
        if (o.name in argMap) {
            const res = o.transformation(argMap[o.name], accumulator)
            callback(o.name, res)
        }
    })

    // Check Bare Commands
    for (let name in commands.bare){
        const o = commands.bare[name]
        if (name in argMap) {
            if (o?.not) {
                const hasNot = o.not.filter(str => !(str in argMap), true)
                if (!hasNot) callback(o.name, true)
            } else callback(o.name, true)
        }
    }
}