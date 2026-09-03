import Router from "./router";
import { LanguageSwitcher } from "./components/LanguageSwitcher/LanguageSwitcher";
import { useI18n } from "./i18n/I18nProvider";

export default function App() {
  const { direction } = useI18n();

  return (
    <div dir={direction}>
      <div style={{ position: "fixed", top: 12, insetInlineEnd: 12, zIndex: 1000 }}>
        <LanguageSwitcher />
      </div>
      <Router />
    </div>
  );
}
