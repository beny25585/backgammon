import { motion } from "motion/react";
import type { GameState, Color } from "@/lib/backgammon/engine";
import styles from "./BearOff.module.css";

interface BearOffProps {
  state: GameState;
  myColor: Color | null;
  isLegalTarget: boolean;
  onClick: () => void;
}

export default function BearOff({ state, isLegalTarget, onClick }: BearOffProps) {
  return (
    <button
      onClick={onClick}
      className={styles.bearOff}
      data-point-idx="off"
    >
      {isLegalTarget && (
        <div className={styles.highlight} />
      )}
      <div className={styles.section}>
        <div className={styles.label}>Black</div>
        {Array.from({ length: Math.min(state.home.black, 15) }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`${styles.checkerPip} ${styles.pipBlack}`}
          />
        ))}
      </div>
      <div className={styles.sectionReverse}>
        <div className={styles.label}>White</div>
        {Array.from({ length: Math.min(state.home.white, 15) }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`${styles.checkerPip} ${styles.pipWhite}`}
          />
        ))}
      </div>
    </button>
  );
}
