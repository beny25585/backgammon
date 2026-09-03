import { useI18n } from "../../i18n/I18nProvider";
import styles from "./LanguageSwitcher.module.css";

export function LanguageSwitcher() {
  const { locale, t, toggleLocale } = useI18n();

  return (
    <button className={styles.button} type="button" aria-label={t("common.language")} onClick={toggleLocale}>
      {locale === "he" ? t("common.english") : t("common.hebrew")}
    </button>
  );
}
