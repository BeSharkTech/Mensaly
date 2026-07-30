import { useEffect, useState } from "react";

/**
 * Cache em memória compartilhado entre rotas: a primeira montagem busca os
 * dados, as seguintes usam o valor em cache e revalidam em segundo plano.
 * Isso evita que cada troca de aba espere uma nova ida ao servidor.
 */
export type CacheStore<T> = {
  get: () => T;
  isLoaded: () => boolean;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<T>;
  ensure: () => Promise<T>;
  reset: () => void;
};

export function createCacheStore<T>(loader: () => Promise<T>, initial: T): CacheStore<T> {
  let value: T = initial;
  let loaded = false;
  let inFlight: Promise<T> | null = null;
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((listener) => listener());

  const refresh = () => {
    if (inFlight) return inFlight;
    inFlight = loader()
      .then((next) => {
        value = next;
        loaded = true;
        emit();
        return next;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    get: () => value,
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
      emit();
    },
  };
}

/** Assina um cache: retorna o valor atual e dispara o carregamento inicial. */
export function useCacheStore<T>(store: CacheStore<T>) {
  const [value, setValue] = useState<T>(() => store.get());
  const [loaded, setLoaded] = useState(() => store.isLoaded());

  useEffect(() => {
    const sync = () => {
      setValue(store.get());
      setLoaded(store.isLoaded());
    };
    const unsubscribe = store.subscribe(sync);
    sync();
    void store.ensure();
    return unsubscribe;
  }, [store]);

  return { value, loaded };
}
