import { useState } from "react";
import { motion } from "motion/react";
import styles from "./GuidanceBanner.module.css";
import type { Color, GameState } from "@/lib/backgammon/engine";
import { getGuidance } from "./guidance";
import type { GuidanceVariant } from "./guidance";

interface GuidanceBannerProps {
  state: GameState;
  playerColor: Color;
  respondToDouble: (accept: boolean) => void;
}

function variantClass(variant: GuidanceVariant): string {
  switch (variant) {
    case "roll":
    case "move":
    case "confirm":
    case "forced":
      return styles.accent;
    case "double":
    case "no-moves":
      return styles.danger;
    default:
      return styles.muted;
  }
}

export default function GuidanceBanner({
  state,
  playerColor,
  respondToDouble,
}: GuidanceBannerProps) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const guidance = getGuidance(state, playerColor);

  if (!guidance) return null;

  if (dismissedKey === guidance.text) return null;

  return (
    <div className={styles.wrapper}>
      <motion.div
        className={`${styles.banner} ${variantClass(guidance.variant)}`}
        data-testid="guidance-banner"
        data-variant={guidance.variant}
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <span className={styles.text}>{guidance.text}</span>
        {guidance.interactive === "double" && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.accept}
              onClick={() => respondToDouble(true)}
              data-testid="double-accept"
            >
              Accept
            </button>
            <button
              type="button"
              className={styles.decline}
              onClick={() => respondToDouble(false)}
              data-testid="double-decline"
            >
              Decline
            </button>
          </div>
        )}
        <button
          type="button"
          className={styles.dismiss}
          onClick={() => setDismissedKey(guidance.text)}
          data-testid="banner-dismiss"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </motion.div>
    </div>
  );
}