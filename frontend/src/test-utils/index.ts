import "../styles/global.css";
import "@fontsource/assistant";
import "@fontsource/playfair-display";
import { disableAnimations } from "./setup";
import { beforeMount } from "@playwright/experimental-ct-react/hooks";
import type { Locale } from "../i18n/messages";

disableAnimations();

beforeMount<{ locale?: Locale }>(async ({ hooksConfig }) => {
  if (!hooksConfig?.locale) return;
  document.documentElement.lang = hooksConfig.locale;
  document.documentElement.dir = hooksConfig.locale === "he" ? "rtl" : "ltr";
  window.localStorage.setItem("backgammon-game-locale", hooksConfig.locale);
});
