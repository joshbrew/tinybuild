export interface WorkerContext {
  signal: AbortSignal;
}
export interface TransferResult<T> {
  readonly value: T;
  readonly transfer: readonly Transferable[];
}
export function transferResult<T>(
  value: T,
  transfer: Transferable[],
): TransferResult<T>;
export function serveWorker(
  handlers: Record<string, (value: any, context: WorkerContext) => unknown>,
  port?: any,
): () => void;
export interface WorkerRunOptions {
  transfer?: Transferable[];
  signal?: AbortSignal;
  timeout?: number;
}
export interface WorkerPool<
  Methods extends { [K in keyof Methods]: { input: unknown; output: unknown } },
> {
  readonly stats: {
    size: number;
    active: number;
    queued: number;
    closed: boolean;
  };
  run<K extends keyof Methods & string>(
    method: K,
    value: Methods[K]["input"],
    options?: WorkerRunOptions,
  ): Promise<Methods[K]["output"]>;
  close(): Promise<void>;
}
export function createWorkerPool<
  Methods extends {
    [K in keyof Methods]: { input: unknown; output: unknown };
  } = Record<string, { input: unknown; output: unknown }>,
>(
  factory: () => any,
  options?: { size?: number; maxQueue?: number },
): WorkerPool<Methods>;
