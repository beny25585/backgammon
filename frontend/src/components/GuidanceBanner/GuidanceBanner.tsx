import { useEffect, useState } from "react";
import { motion } from "motion/react";
import styles from "./GuidanceBanner.module.css";
import type { Color, GameState } from "@/lib/backgammon/engine";
import { getGuidance } from "./guidance";
import type { GuidanceVariant } from "./guidance";
import { useI18n } from "../../i18n/I18nProvider";

export interface GuidanceMessage {
  variant: GuidanceVariant;
  textKey: string;
}

interface GuidanceBannerProps {
  state?: GameState;
  playerColor?: Color;
  respondToDouble?: (accept: boolean) => void;
  message?: GuidanceMessage | null;
  inline?: boolean;
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
  message,
  inline = false,
}: GuidanceBannerProps) {
  const { t, locale } = useI18n();
  const [responding, setResponding] = useState(false);

  const guidance = message
    ? { ...message, interactive: null }
    : state && playerColor
      ? getGuidance(state, playerColor)
      : null;
  const isDecision = guidance?.interactive === "double";

  useEffect(() => {
    setResponding(false);
  }, [guidance?.variant, guidance?.textKey]);

  if (!guidance) return null;

  if (!message && !isDecision) return null;

  const respond = (accept: boolean) => {
    if (responding) return;
    setResponding(true);
    respondToDouble?.(accept);
  };

  const text = t(guidance.textKey);

  return (
    <div
      className={
        inline
          ? styles.inline
          : `${styles.wrapper} ${isDecision ? styles.decision : styles.toast}`
      }
    >
      <motion.div
        className={`${styles.banner} ${variantClass(guidance.variant)}`}
        data-testid="guidance-banner"
        data-variant={guidance.variant}
        role={isDecision ? "dialog" : "status"}
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <span
          className={styles.text}
          dir={locale === "he" ? "rtl" : "ltr"}
          lang={locale}
        >
          {text}
        </span>
        {isDecision && (
          <div className={styles.actions} dir="ltr">
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
