export function createHotContext<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  id?: string,
  source?: string | URL,
): {
  data: T;
  dispose(
    callback: (data: T, message: unknown) => void | Promise<void>,
  ): () => void;
  accept(
    callback?: (data: T, message: unknown) => void | Promise<void>,
  ): () => void;
  invalidate(): void;
};
