import { useEffect, useState } from "react";

/**
 * Cache em memória compartilhado entre rotas: a primeira montagem busca os
 * dados, as seguintes usam o valor em cache e revalidam em segundo plano.
 * Isso evita que cada troca de aba espere uma nova ida ao servidor.
 */
export type CacheStore<T> = {
  get: () => T;
  getError: () => Error | null;
  isLoaded: () => boolean;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<T>;
  ensure: () => Promise<T>;
  reset: () => void;
};

export function createCacheStore<T>(
  loader: () => Promise<T>,
  initial: T,
): CacheStore<T> {
  let value: T = initial;
  let loaded = false;
  let lastError: Error | null = null;
  let inFlight: Promise<T> | null = null;
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((listener) => listener());

  const refresh = () => {
    if (inFlight) return inFlight;
    inFlight = loader()
      .then((next) => {
        value = next;
        loaded = true;
        lastError = null;
        emit();
        return next;
      })
      .catch((error: unknown) => {
        lastError =
          error instanceof Error ? error : new Error("Cache loader failed");
        emit();
        throw lastError;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    get: () => value,
    getError: () => lastError,
    isLoaded: () => loaded,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    ensure: () => (loaded ? Promise.resolve(value) : refresh()),
    reset: () => {
      value = initial;
      loaded = false;
      lastError = null;
      emit();
    },
  };
}

/** Assina um cache: retorna o valor atual e dispara o carregamento inicial. */
export function useCacheStore<T>(store: CacheStore<T>) {
  const [value, setValue] = useState<T>(() => store.get());
  const [loaded, setLoaded] = useState(() => store.isLoaded());
  const [error, setError] = useState<Error | null>(() => store.getError());

  useEffect(() => {
    const sync = () => {
      setValue(store.get());
      setLoaded(store.isLoaded());
      setError(store.getError());
    };
    const unsubscribe = store.subscribe(sync);
    sync();
    void store.ensure().catch(() => undefined);
    return unsubscribe;
  }, [store]);

  return { value, loaded, error };
}
