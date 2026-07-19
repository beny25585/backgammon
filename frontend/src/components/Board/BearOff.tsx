import { motion } from "motion/react";
import type { GameState, Color } from "@/lib/backgammon/engine";
import styles from "./BearOff.module.css";

export function BearOff({
  state,
  isLegalTarget,
  onClick,
  className,
}: {
  state: GameState;
  myColor: Color | null;
  isLegalTarget: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`${styles.bearOff} focus:outline-none ${className ?? ""}`}
    >
      {isLegalTarget && <div className="absolute inset-0 bg-[rgba(232,191,135,0.4)] animate-pulse-glow" />}
      <div className="flex flex-col gap-0.5 items-center relative">
        <div className="text-[9px] sm:text-[10px] text-gold mb-1">שחור</div>
        {Array.from({ length: Math.min(state.home.black, 15) }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`${styles.checkerPip} ${styles.pipBlack}`}
          />
        ))}
      </div>
      <div className="flex flex-col-reverse gap-0.5 items-center relative">
        <div className="text-[9px] sm:text-[10px] text-gold mt-1">לבן</div>
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
