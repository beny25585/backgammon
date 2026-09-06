import styles from "./PlayerRow.module.css";
import type { GameState, Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";

interface PlayerRowProps {
  color: Color;
  state: GameState;
  label: string;
  active: boolean;
  self: boolean;
  score?: number;
}

export default function PlayerRow({
  color,
  state,
  label,
  active,
  self,
  score,
}: PlayerRowProps) {
  const { t } = useI18n();
  const checkersOff = color === "white" ? state.home.white : state.home.black;
  const checkersOnBar = color === "white" ? state.bar.white : state.bar.black;

  return (
    <div
      className={`${styles.row} ${self ? styles.self : styles.opponent} ${active ? (self ? styles.activeSelf : styles.activeOpponent) : styles.idle}`}
    >
      <span className={`${styles.avatar} ${styles[color]}`} />
      <div className={styles.info}>
        <span className={styles.name} data-testid={`player-name-${color}`}>
          {label}
        </span>
        <span className={styles.meta}>
          {t("common.off", { count: checkersOff })}
          <span>{t("common.bar", { count: checkersOnBar })}</span>
        </span>
      </div>
      <div className={styles.scoreWrap}>
        {active && (
          <span className={styles.turnBadge}>
            {self ? t("common.yourTurn") : t("common.theirTurn")}
          </span>
        )}
        <span className={styles.score} data-testid={`player-score-${color}`}>
          {score}
        </span>
      </div>
    </div>
  );
}
