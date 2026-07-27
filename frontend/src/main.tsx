import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
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
    <BrowserRouter basename="/backgammon">
      <App />
    </BrowserRouter>
  </StrictMode>,
);
