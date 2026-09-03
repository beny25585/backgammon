import { useEffect, useState } from "react";
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
  const [responding, setResponding] = useState(false);
  const [showTransient, setShowTransient] = useState(false);

  const guidance = getGuidance(state, playerColor);
  const isDecision = guidance?.interactive === "double";
  const isTransient =
    guidance?.variant === "forced" || guidance?.variant === "no-moves";

  useEffect(() => {
    setResponding(false);
  }, [guidance?.variant, guidance?.text]);

  useEffect(() => {
    if (!isTransient) {
      setShowTransient(false);
      return;
    }
    setShowTransient(true);
    const timeout = window.setTimeout(() => setShowTransient(false), 1400);
    return () => window.clearTimeout(timeout);
  }, [guidance?.variant, guidance?.text, isTransient]);

  if (!guidance) return null;

  if (!isDecision && (!isTransient || !showTransient)) return null;

  const respond = (accept: boolean) => {
    if (responding) return;
    setResponding(true);
    respondToDouble(accept);
  };

  return (
    <div className={`${styles.wrapper} ${isDecision ? styles.decision : styles.toast}`}>
      <motion.div
        className={`${styles.banner} ${variantClass(guidance.variant)}`}
        data-testid="guidance-banner"
        data-variant={guidance.variant}
        role={isDecision ? "dialog" : "status"}
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <span className={styles.text}>{guidance.text}</span>
        {isDecision && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.accept}
              onClick={() => respond(true)}
              disabled={responding}
              data-testid="double-accept"
            >
              {responding ? "Sending..." : "Accept"}
            </button>
            <button
              type="button"
              className={styles.decline}
              onClick={() => respond(false)}
              disabled={responding}
              data-testid="double-decline"
            >
              Decline
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
