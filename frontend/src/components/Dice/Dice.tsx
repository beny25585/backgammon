import { motion } from "motion/react";
import { useState, useRef } from "react";
import type { Color } from "@/lib/backgammon/engine";
import RollingDie from "@animations/RollingDie/RollingDie";
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

/** Finger-tap icon — signals the button is clickable */
function TapIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74z" />
      <path d="M21.84 16.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H16v-6c0-.83-.67-1.5-1.5-1.5S13 7.17 13 8v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z" />
    </svg>
  );
}

/** Animated rolling dice — tap to roll. Spins until the real result (landOn) arrives, then lands. */
export function RollPrompt({
  onRoll,
  count = 2,
  isOpening,
  dark,
  landOn,
  onLand,
}: {
  onRoll: () => void;
  count?: number;
  isOpening?: boolean;
  dark?: boolean;
  landOn?: number[];
  onLand?: () => void;
}) {
  const [rolling, setRolling] = useState(false);
  const fired = useRef(false);

  function handleClick() {
    if (fired.current) return;
    fired.current = true;
    setRolling(true);
    // Keep the dice spinning so the animation is visible, then request the roll
    window.setTimeout(() => onRoll(), 1000);
  }

  return (
    <motion.button
      onClick={handleClick}
      className={styles.rollBtn}
      data-testid="roll-prompt-btn"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.94 }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <span className={styles.pulseRing} aria-hidden="true" />
      <span
        className={`${styles.pulseRing} ${styles.pulseRingDelay}`}
        aria-hidden="true"
      />
      <TapIcon className={styles.tapIcon} />
      <RollingDie
        rolling={rolling}
        count={count}
        isOpening={isOpening}
        dark={dark}
        landOn={landOn}
        onRollComplete={onLand}
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
