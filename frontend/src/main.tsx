import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/assistant";
import "@fontsource/playfair-display";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { clientLogger } from "./services/logger";
import "./styles/global.css";

window.addEventListener("error", (e) => {
  clientLogger.error(e.message, { filename: e.filename, lineno: e.lineno, colno: e.colno });
});

window.addEventListener("unhandledrejection", (e) => {
  clientLogger.error("Unhandled promise rejection", { reason: String(e.reason) });
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter basename="/backgammon">
        <App />
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);
