import { motion } from "motion/react";
import { useState, useRef, useCallback } from "react";
import type { Color } from "@/lib/backgammon/engine";
import RollingDie from "../animations/RollingDie/RollingDie";
import { pipPositions } from "../animations/RollingDie/pipPositions";
import styles from "./Dice.module.css";

export function Die({
  value,
  used,
  dark,
}: {
  value: number;
  used?: boolean;
  dark?: boolean;
}) {
  return (
    <motion.div
      initial={{ rotate: -360, scale: 0.4, opacity: 0 }}
      animate={{ rotate: 1, scale: 1, opacity: used ? 0.3 : 1 }}
      whileHover={
        !used ? { scale: 1.08, rotate: 8 } : { scale: 1.9, rotate: 1 }
      }
      transition={{ type: "spring", stiffness: 100, damping: 5 }}
      className={`${styles.die} ${dark ? styles.dieDark : styles.dieLight}`}
      data-testid="die"
    >
      {pipPositions[value]?.map(([x, y], i) => (
        <span
          key={i}
          className={`${styles.pip} ${styles.pipCurrent}`}
          style={{
            left: `${x}%`,
            top: `${y}%`,
          }}
        />
      ))}
    </motion.div>
  );
}

export function DiceRow({
  dice,
  remaining,
  color,
  showLabels,
  myRoll,
  opponentRoll,
}: {
  dice: number[];
  remaining: number[];
  color: "white" | "black";
  showLabels?: boolean;
  myRoll?: number | null;
  opponentRoll?: number | null;
  winner?: Color | null;
}) {
  if (showLabels) {
    return (
      <div className={styles.diceRowLabeled}>
        {myRoll !== undefined && (
          <div className={styles.dieColumn}>
            <Die value={myRoll!} dark={color === "black"} />
            <span className={styles.label}>You</span>
          </div>
        )}
        {opponentRoll !== undefined && (
          <div className={styles.dieColumn}>
            <Die value={opponentRoll!} dark={color !== "black"} />
            <span className={styles.label}>Opponent</span>
          </div>
        )}
      </div>
    );
  }

  if (dice.length === 0) return null;
  const displayed =
    dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice;
  const remCopy = [...remaining];
  return (
    <div className={styles.diceRow}>
      {displayed.map((d, i) => {
        const idx = remCopy.indexOf(d);
        const used = idx < 0;
        if (idx >= 0) remCopy.splice(idx, 1);
        return <Die key={i} value={d} used={used} dark={color === "black"} />;
      })}
    </div>
  );
}

/** Animated rolling dice — click to trigger the actual roll */
export function RollPrompt({
  onRoll,
  count = 2,
  isOpening,
  dark,
}: {
  onRoll: () => void;
  count?: number;
  isOpening?: boolean;
  dark?: boolean;
}) {
  const [rolling, setRolling] = useState(false);
  const rollDone = useRef(false);

  const handleRollComplete = useCallback(() => {
    if (rollDone.current) return;
    rollDone.current = true;
    setRolling(false);
    onRoll();
  }, [onRoll]);

  function handleClick() {
    rollDone.current = false;
    setRolling(true);
  }

  return (
    <motion.button
      onClick={handleClick}
      className={styles.rollBtn}
      whileTap={{ scale: 0.92 }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <RollingDie
        rolling={rolling}
        count={count}
        isOpening={isOpening}
        dark={dark}
        onRollComplete={handleRollComplete}
      />
      <motion.span
        className={styles.rollLabel}
        animate={{ opacity: rolling ? 0 : [0.5, 0.7, 0.3] }}
        transition={
          rolling ? { duration: 1 } : { duration: 6, repeat: Infinity }
        }
      >
        Tap to roll
      </motion.span>
    </motion.button>
  );
}
