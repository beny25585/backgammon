import { motion } from "motion/react";
import type { GameState, Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../../../i18n/I18nProvider";
import styles from "./BearOff.module.css";

interface BearOffProps {
  state: GameState;
  myColor: Color | null;
  isLegalTarget: boolean;
  onClick: () => void;
}

export default function BearOff({ state, myColor, isLegalTarget, onClick }: BearOffProps) {
  const { t } = useI18n();
  const bottomBearOffColor: Color = myColor ?? "white";
  const topBearOffColor: Color = bottomBearOffColor === "white" ? "black" : "white";

  return (
    <button
      onClick={onClick}
      className={styles.bearOff}
      data-point-idx="off"
    >
      {isLegalTarget && (
        <div className={styles.highlight} />
      )}
      <div className={styles.section} data-testid="bear-off-top">
        <div className={styles.label}>
          <span>{t(topBearOffColor === "white" ? "common.white" : "common.black")}</span>
          <span className={styles.count}>{state.home[topBearOffColor]}</span>
        </div>
        {Array.from({ length: Math.min(state.home[topBearOffColor], 15) }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`${styles.checkerPip} ${topBearOffColor === "white" ? styles.pipWhite : styles.pipBlack}`}
          />
        ))}
      </div>
      <div className={styles.sectionReverse} data-testid="bear-off-bottom">
        <div className={styles.label}>
          <span>{t(bottomBearOffColor === "white" ? "common.white" : "common.black")}</span>
          <span className={styles.count}>{state.home[bottomBearOffColor]}</span>
        </div>
        {Array.from({ length: Math.min(state.home[bottomBearOffColor], 15) }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`${styles.checkerPip} ${bottomBearOffColor === "white" ? styles.pipWhite : styles.pipBlack}`}
          />
        ))}
      </div>
    </button>
  );
}
