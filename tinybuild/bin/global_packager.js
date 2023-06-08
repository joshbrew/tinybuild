import { packager, defaultConfig } from "../packager.js";
//this file is used to run and watch command line stuff with just a local config file
//the packager will parse any command line arguments

function exitHandler(options, exitCode) {

    if (exitCode || exitCode === 0) console.log('SERVER EXITED WITH CODE: ', exitCode);
    if (options.exit) process.exit();
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));
process.on(2, exitHandler.bind(null,{cleanup:true, exit:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

//we'll run the server separately from the tinybuild script 
packager(defaultConfig, false).then((packaged) => {
    (function wait () {
        setTimeout(wait, 1000); //run forever
     })();
});