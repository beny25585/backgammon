import { useEffect, useState } from "react";
import { motion } from "motion/react";
import styles from "./GuidanceBanner.module.css";
import type { Color, GameState } from "@/lib/backgammon/engine";
import { getGuidance } from "./guidance";
import type { GuidanceVariant } from "./guidance";
import { useI18n } from "../../i18n/I18nProvider";

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

const guidanceTextKeys: Record<string, string> = {
  "Waiting to start": "guidance.waitingStart",
  "Roll to start": "guidance.rollStart",
  "Waiting for opponent's roll": "guidance.waitingRoll",
  "You go first!": "guidance.youFirst",
  "Opponent goes first": "guidance.opponentFirst",
  "Opponent offers a double!": "guidance.opponentDouble",
  "Waiting for their response": "guidance.waitingResponse",
  "Your turn — tap to roll": "guidance.yourRoll",
  "Opponent is thinking…": "guidance.opponentThinking",
  "Confirm your turn": "guidance.confirmTurn",
  "No moves available — turn passes": "guidance.noMoves",
  "Forced move — playing automatically": "guidance.forcedMove",
  "Waiting…": "guidance.waiting",
};

export default function GuidanceBanner({
  state,
  playerColor,
  respondToDouble,
}: GuidanceBannerProps) {
  const { t, locale } = useI18n();
  const [responding, setResponding] = useState(false);

  const guidance = getGuidance(state, playerColor);
  const isDecision = guidance?.interactive === "double";

  useEffect(() => {
    setResponding(false);
  }, [guidance?.variant, guidance?.text]);

  if (!guidance) return null;

  if (!isDecision) return null;

  const respond = (accept: boolean) => {
    if (responding) return;
    setResponding(true);
    respondToDouble(accept);
  };

  const text =
    locale === "he"
      ? t(guidanceTextKeys[guidance.text] ?? `guidance.${guidance.variant}`)
      : guidance.text;

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
        <span className={styles.text}>{text}</span>
        {isDecision && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.accept}
              onClick={() => respond(true)}
              disabled={responding}
              data-testid="double-accept"
              title={t("common.takeDouble")}
            >
              {responding ? t("common.sending") : t("common.take")}
            </button>
            <button
              type="button"
              className={styles.decline}
              onClick={() => respond(false)}
              disabled={responding}
              data-testid="double-decline"
              title={t("common.passDouble")}
            >
              {t("common.pass")}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
