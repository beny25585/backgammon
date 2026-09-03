import { useI18n } from "../../i18n/I18nProvider";
import { BOARD_THEMES, type BoardTheme } from "./boardThemes";
import styles from "./BoardThemeSelector.module.css";

const themeSwatches: Record<BoardTheme, string> = {
  redGreen: styles.redGreen,
  blueIvory: styles.blueIvory,
  ivoryGold: styles.ivoryGold,
};

const themeLabelKeys: Record<BoardTheme, string> = {
  redGreen: "game.boardThemeRedGreen",
  blueIvory: "game.boardThemeBlueIvory",
  ivoryGold: "game.boardThemeIvoryGold",
};

const themeDescriptionKeys: Record<BoardTheme, string> = {
  redGreen: "game.boardThemeRedGreenText",
  blueIvory: "game.boardThemeBlueIvoryText",
  ivoryGold: "game.boardThemeIvoryGoldText",
};

interface BoardThemeSelectorProps {
  value: BoardTheme;
  onChange: (theme: BoardTheme) => void;
}

export default function BoardThemeSelector({
  value,
  onChange,
}: BoardThemeSelectorProps) {
  const { t } = useI18n();

  return (
    <section className={styles.selector} aria-label={t("game.boardTheme")}>
      <div className={styles.header}>
        <span>{t("game.boardTheme")}</span>
      </div>
      <div className={styles.options}>
        {BOARD_THEMES.map((theme) => (
          <button
            key={theme}
            type="button"
            className={`${styles.option} ${value === theme ? styles.active : ""}`}
            aria-pressed={value === theme}
            onClick={() => onChange(theme)}
          >
            <span className={`${styles.swatch} ${themeSwatches[theme]}`}>
              <span />
              <span />
              <span />
            </span>
            <span className={styles.copy}>
              <strong>{t(themeLabelKeys[theme])}</strong>
              <small>{t(themeDescriptionKeys[theme])}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
