import { useState, useEffect } from 'react';

export function usePersistentTab<T extends string>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  // Initialize from sessionStorage or use default
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(`tab-state-${key}`);
      return (stored as T) || defaultValue;
    } catch {
      return defaultValue;
    }
  });

  // Save to sessionStorage whenever it changes
  useEffect(() => {
    try {
      sessionStorage.setItem(`tab-state-${key}`, value);
    } catch {
      // Ignore storage errors
    }
  }, [key, value]);

  return [value, setValue];
}
