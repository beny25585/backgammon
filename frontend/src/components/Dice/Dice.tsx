import { motion } from "motion/react";
import { useState, useRef, useCallback } from "react";
import type { Color } from "@/lib/backgammon/engine";
import styles from "./Dice.module.css";

const pipPositions: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [25, 25],
    [75, 75],
  ],
  3: [
    [25, 25],
    [50, 50],
    [75, 75],
  ],
  4: [
    [25, 25],
    [75, 25],
    [25, 75],
    [75, 75],
  ],
  5: [
    [25, 25],
    [75, 25],
    [50, 50],
    [25, 75],
    [75, 75],
  ],
  6: [
    [25, 25],
    [75, 25],
    [25, 50],
    [75, 50],
    [25, 75],
    [75, 75],
  ],
};

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

/** A single die face with pip pattern for the 3D cube */
function DieFace({
  value,
  side,
  dark,
}: {
  value: number;
  side?: string;
  dark?: boolean;
}) {
  return (
    <div
      className={`${styles.dieFace} ${dark ? styles.faceDark : styles.faceLight}`}
      style={{
        backfaceVisibility: "hidden",
        transform: side || undefined,
      }}
    >
      {pipPositions[value]?.map(([x, y], i) => (
        <span
          key={i}
          className={styles.pip}
          style={{
            left: `${x}%`,
            top: `${y}%`,
            backgroundColor: dark ? "#f4e4c1" : "#2a1810",
          }}
        />
      ))}
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
      <div className={styles.rollContainer} style={{ perspective: 600 }}>
        {Array.from({ length: isOpening ? 1 : count }).map((_, i) => (
          <motion.div
            key={i}
            className={styles.cube}
            onAnimationComplete={handleRollComplete}
            style={{
              width: "clamp(48px, 10vw, 64px)",
              height: "clamp(48px, 10vw, 64px)",
              transformStyle: "preserve-3d",
            }}
            animate={
              rolling
                ? {
                    rotateX: [0, 720, 1440],
                    rotateY: [0, 360, 1080],
                    rotateZ: [-15, 20, -10, 15, 0],
                  }
                : {
                    rotateX: [0, 360, 720],
                    rotateY: [0, 180, 540],
                    rotateZ: [-3, 5, -2, 5, -3, 1, 0],
                  }
            }
            transition={
              rolling
                ? {
                    rotateX: { duration: 2, ease: "easeOut" },
                    rotateY: { duration: 2, ease: "easeOut" },
                    rotateZ: { duration: 2, ease: "easeOut" },
                  }
                : {
                    rotateX: {
                      duration: 5.0,
                      repeat: Infinity,
                      ease: "linear",
                      delay: i * 0.08,
                    },
                    rotateY: {
                      duration: 6,
                      repeat: Infinity,
                      ease: "linear",
                      delay: i * 0.12,
                    },
                    rotateZ: {
                      duration: 6,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: i * 0.15,
                    },
                  }
            }
          >
            <DieFace
              value={1}
              dark={dark}
              side="translateZ(calc(clamp(24px,5vw,32px)))"
            />
            <DieFace
              value={6}
              dark={dark}
              side="rotateY(180deg) translateZ(calc(clamp(24px,5vw,32px)))"
            />
            <DieFace
              value={3}
              dark={dark}
              side="rotateY(-90deg) translateZ(calc(clamp(24px,5vw,32px)))"
            />
            <DieFace
              value={4}
              dark={dark}
              side="rotateY(90deg) translateZ(calc(clamp(24px,5vw,32px)))"
            />
            <DieFace
              value={2}
              dark={dark}
              side="rotateX(-90deg) translateZ(calc(clamp(24px,5vw,32px)))"
            />
            <DieFace
              value={5}
              dark={dark}
              side="rotateX(90deg) translateZ(calc(clamp(24px,5vw,32px)))"
            />
          </motion.div>
        ))}
      </div>
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
