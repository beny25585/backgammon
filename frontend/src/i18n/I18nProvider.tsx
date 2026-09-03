import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { messages, type Locale } from "./messages";

type I18nContextValue = {
  locale: Locale;
  direction: "ltr" | "rtl";
  t: (key: string, params?: Record<string, string | number>) => string;
  toggleLocale: () => void;
};

const STORAGE_KEY = "backgammon-game-locale";
const locales = Object.keys(messages) as Locale[];
const I18nContext = createContext<I18nContextValue | null>(null);

function initialLocale(): Locale {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved && locales.includes(saved as Locale)) return saved as Locale;
  return window.navigator.language.startsWith("he") ? "he" : "en";
}

function lookup(locale: Locale, key: string): string | undefined {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object" && part in value) {
      return (value as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages[locale]) as string | undefined;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const direction = locale === "he" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [direction, locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    direction,
    t: (key, params = {}) => {
      const template = lookup(locale, key) ?? key;
      return Object.entries(params).reduce(
        (text, [name, paramValue]) => text.split(`{${name}}`).join(String(paramValue)),
        template,
      );
    },
    toggleLocale: () => setLocale((current) => (current === "he" ? "en" : "he")),
  }), [direction, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
