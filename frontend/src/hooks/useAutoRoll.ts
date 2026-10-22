import { useEffect, useState } from "react";

const STORAGE_KEY = "bg_auto_roll";

export function useAutoRoll() {
  const [autoRoll, setAutoRoll] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(autoRoll));
    } catch {
      // The in-game switch still works when browser storage is unavailable.
    }
  }, [autoRoll]);
  return [autoRoll, setAutoRoll] as const;
}
