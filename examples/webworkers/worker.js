

//contian this in a scope to prevent execution when importing. 
if(self instanceof WorkerGlobalScope) {
    console.log("Worker!");

    self.onmessage = (ev) => {
        console.log(ev);
    }
}

export default self;