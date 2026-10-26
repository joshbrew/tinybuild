export function createNativeBridge<
  T extends Record<string, (...args: any[]) => any>,
>(options?: {
  native?: Partial<T>;
  web?: Partial<T>;
  isNative?: () => boolean;
}): {
  has(name: keyof T): boolean;
  call<K extends keyof T>(
    name: K,
    ...args: Parameters<T[K]>
  ): Promise<Awaited<ReturnType<T[K]>>>;
};

export interface AppLifecycleState {
  active: boolean;
  online: boolean;
  reason: "initial" | "visibility" | "network" | "native";
}
export function watchAppLifecycle(options: {
  onChange: (state: AppLifecycleState) => void;
  nativeApp?: {
    addListener(
      event: "appStateChange",
      listener: (event: { isActive: boolean }) => void,
    ): Promise<{ remove(): Promise<void> }> | { remove(): Promise<void> };
  };
  window?: Pick<Window, "addEventListener" | "removeEventListener">;
  document?: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;
  navigator?: Pick<Navigator, "onLine">;
  onError?: (error: unknown) => void;
}): { close(): Promise<void> };
