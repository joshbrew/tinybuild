// The bundler exposes a URL and factory instead of the worker's source exports.
declare const workerURL: string;
export default workerURL;
export declare function createWorker(options?: WorkerOptions): Worker;
export declare function revokeWorkerURL(): void;
