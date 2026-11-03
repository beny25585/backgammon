import { useCallback, useEffect, useState } from "react";

/** Browser preferences shared with the club on the same origin. */
export function useStoredPreference<T extends string | boolean>(
  key: string,
  defaultValue: T,
  parse: (saved: string | null) => T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      return parse(window.localStorage.getItem(key));
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    const refresh = () => {
      try {
        setValue(parse(window.localStorage.getItem(key)));
      } catch {
        // Keep the in-memory choice if browser storage becomes unavailable.
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [key, parse]);

  const updateValue = useCallback((nextValue: T) => {
    setValue(nextValue);
    try {
      window.localStorage.setItem(key, String(nextValue));
    } catch {
      // The in-game controls still work without persistent storage.
    }
  }, [key]);

  return [value, updateValue] as const;
}
