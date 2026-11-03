import { useStoredPreference } from "./useStoredPreference";

const STORAGE_KEY = "bg_auto_roll";
const parseAutoRoll = (saved: string | null) => saved === "true";

export function useAutoRoll() {
  return useStoredPreference(STORAGE_KEY, false, parseAutoRoll);
}
