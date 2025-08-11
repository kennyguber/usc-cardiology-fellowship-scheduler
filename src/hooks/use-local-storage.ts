import { useEffect } from "react";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const getStored = (): T => {
    try {
      const item = localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  };

  let state = getStored();

  const setState = (value: T | ((prev: T) => T)) => {
    const next = value instanceof Function ? value(state) : value;
    state = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    } catch {}
    return next;
  };

  // Sync across tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === key) {
        try {
          state = e.newValue ? (JSON.parse(e.newValue) as T) : initialValue;
        } catch {}
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [key]);

  return [state, setState] as const;
}
