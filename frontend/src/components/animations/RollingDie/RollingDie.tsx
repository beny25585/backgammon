import { motion } from "motion/react";
import styles from "./RollingDie.module.css";
import { pipPositions } from "./pipPositions";
import {
  DIE_FACES,
  CUBE_FACES,
  FACE_SIDES,
  landingRotation,
} from "./landingRotation";

/*
 * HOW TO CHANGE THE SPINNING ANIMATION
 * ------------------------------------
 * - Spin speed/duration: edit the `transition` objects below. `rotateX`/`rotateY`
 *   `duration` (2 = roll settle, 5-6 = idle spin). Larger = slower.
 * - Landing on a value: pass `landOn` (one target per cube). The animation adds
 *   full spins and settles on the rotation from landingRotation(), so the cube
 *   ends showing the target value. Leave `landOn` unset to keep spinning forever
 *   (used while waiting for the roll result from the server).
 * - Size: edit the inline `width`/`height` `clamp()` on the cube below.
 * - Faces: edit landingRotation.ts — DIE_FACES/CUBE_FACES for which values sit on
 *   the six faces, FACE_SIDES for their transforms, FACE_TO_FRONT for landing math.
 */

/** A single cube face: pip pattern (dice) or a centered value (doubling cube). */
function DieFace({
  faceValue,
  side,
  dark,
  variant,
  faceColor,
}: {
  faceValue: number;
  side?: string;
  dark?: boolean;
  variant?: "pips" | "value";
  faceColor?: string;
}) {
  return (
    <div
      className={`${styles.dieFace} ${
        variant === "value"
          ? styles.faceValue
          : dark
            ? styles.faceDark
            : styles.faceLight
      }`}
      data-testid="die-face"
      style={{
        backfaceVisibility: "hidden",
        transform: side || undefined,
        color: variant === "value" ? faceColor : undefined,
      }}
    >
      {variant === "value" ? (
        <span className={styles.faceNumber}>{faceValue}</span>
      ) : (
        pipPositions[faceValue]?.map(([x, y], i) => (
          <span
            key={i}
            className={styles.pip}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              backgroundColor: dark
                ? "var(--lux-die-pip-light, #edf2ff)"
                : "var(--lux-die-pip-dark, #20245a)",
            }}
          />
        ))
      )}
    </div>
  );
}

interface RollingDieProps {
  rolling: boolean;
  count: number;
  isOpening?: boolean;
  dark?: boolean;
  variant?: "pips" | "value";
  value?: number;
  valueColor?: string;
  size?: string;
  landOn?: number[];
  spins?: boolean;
  onRollComplete?: () => void;
}

/** Animated 3D rolling cube — pip faces (dice) or value faces (doubling cube). */
export default function RollingDie({
  rolling,
  count,
  isOpening,
  dark,
  variant = "pips",
  valueColor,
  size,
  landOn,
  spins = false,
  onRollComplete,
}: RollingDieProps) {
  const layout = variant === "value" ? CUBE_FACES : DIE_FACES;
  const faceValues = variant === "value" ? CUBE_FACES : DIE_FACES;

  return (
    <div className={styles.rollContainer} style={{ perspective: 600 }}>
      {Array.from({ length: isOpening ? 1 : count }).map((_, i) => {
        const target = landOn?.[i];
        const hasTarget = target != null;
        const final = hasTarget
          ? landingRotation(target, layout)
          : { rotateX: 0, rotateY: 0 };

        return (
          <motion.div
            key={i}
            className={styles.cube}
            onAnimationComplete={hasTarget ? onRollComplete : undefined}
            data-testid="rolling-die"
            style={{
              width: size ?? "clamp(64px, 14vw, 88px)",
              height: size ?? "clamp(64px, 14vw, 88px)",
              transformStyle: "preserve-3d",
            }}
            animate={
              hasTarget
                ? spins
                  ? {
                      rotateX: 1440 + final.rotateX + 360,
                      rotateY: 1080 + final.rotateY + 360,
                      rotateZ: 0,
                    }
                  : {
                      rotateX: final.rotateX + 360,
                      rotateY: final.rotateY + 360,
                      rotateZ: 0,
                    }
                : rolling
                  ? {
                      rotateX: 1440,
                      rotateY: 1080,
                      rotateZ: [-15, 20, -10, 15, 0],
                    }
                  : {
                      rotateX: [0, 360, 720],
                      rotateY: [0, 180, 540],
                      rotateZ: [-3, 5, -2, 5, -3, 1, 0],
                    }
            }
            transition={
              hasTarget || rolling
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
            {faceValues.map((v, fi) => (
              <DieFace
                key={fi}
                faceValue={v}
                dark={dark}
                variant={variant}
                faceColor={variant === "value" ? valueColor : undefined}
                side={FACE_SIDES[fi]}
              />
            ))}
          </motion.div>
        );
      })}
    </div>
  );
}
