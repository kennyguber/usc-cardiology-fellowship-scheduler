import { useState, useEffect } from 'react';

export function usePersistentTab<T extends string>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  // Initialize from sessionStorage or use default
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(`tab-state-${key}`);
      if (stored && stored !== 'null' && stored !== 'undefined') {
        return stored as T;
      }
      return defaultValue;
    } catch {
      return defaultValue;
    }
  });

  // Save to sessionStorage whenever it changes
  useEffect(() => {
    try {
      if (value) {
        sessionStorage.setItem(`tab-state-${key}`, value);
      }
    } catch {
      // Ignore storage errors
    }
  }, [key, value]);

  return [value, setValue];
}
