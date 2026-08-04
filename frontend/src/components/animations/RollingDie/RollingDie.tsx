import { motion } from "motion/react";
import styles from "./RollingDie.module.css";

export const pipPositions: Record<number, [number, number][]> = {
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
      data-testid="die-face"
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

interface RollingDieProps {
  rolling: boolean;
  count: number;
  isOpening?: boolean;
  dark?: boolean;
  onRollComplete?: () => void;
}

/** Animated 3D rolling dice cubes — idle spin or rolling spin */
export default function RollingDie({
  rolling,
  count,
  isOpening,
  dark,
  onRollComplete,
}: RollingDieProps) {
  return (
    <div className={styles.rollContainer} style={{ perspective: 600 }}>
      {Array.from({ length: isOpening ? 1 : count }).map((_, i) => (
        <motion.div
          key={i}
          className={styles.cube}
          onAnimationComplete={onRollComplete}
          data-testid="rolling-die"
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
  );
}
