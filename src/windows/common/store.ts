import { useEffect, useState } from 'preact/hooks';

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(listener: (state: T) => void): () => void;
}

/** A minimal observable store. UI subscribes to coarse state only, never pointer moves. */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(state: T) => void>();
  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const key in patch) {
        if (!Object.is(state[key], patch[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribes a component to a slice of a store; re-renders only when the slice changes. */
export function useStore<T, S>(store: Store<T>, select: (state: T) => S): S {
  const [value, setValue] = useState(() => select(store.get()));
  useEffect(() => {
    const update = (state: T) => {
      const next = select(state);
      setValue((prev) => (shallowEqual(prev, next) ? prev : next));
    };
    const unsubscribe = store.subscribe(update);
    // Effects run after the first render: catch changes made in between.
    update(store.get());
    return unsubscribe;
  }, [store]);
  return value;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) =>
    Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
