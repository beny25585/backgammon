import { useEffect, useState } from "react";
import styles from "./InactivityBanner.module.css";
import type { Color, GameState } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";

interface InactivityBannerProps {
  state?: GameState | null;
  playerColor?: Color;
}

function formatCountdown(totalSeconds: number): string {
  const total = Math.max(0, totalSeconds);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Server-authoritative inactivity warning. Visible only while the persisted
 * state carries a warning block; the countdown is derived from the absolute
 * server deadline and repainted locally. Never decides any outcome: at 00:00
 * the banner stays until the server sends `game_ended`, and any new state
 * without the block hides it immediately. Never intercepts board input.
 */
export default function InactivityBanner({ state, playerColor }: InactivityBannerProps) {
  const { t, locale } = useI18n();
  const block = state?.inactivity;
  const warned =
    !!block &&
    block.warnedAtMs != null &&
    block.deadlineMs != null &&
    state?.phase !== "game_over";
  const deadlineMs = warned ? (block?.deadlineMs as number) : null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadlineMs == null) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [deadlineMs]);

  if (!warned || deadlineMs == null || !block) return null;
  const remaining = Math.max(0, Math.ceil((deadlineMs - now) / 1000));
  const selfInactive = playerColor != null && block.player === playerColor;

  return (
    <div
      className={styles.wrapper}
      role="status"
      data-testid="inactivity-banner"
      data-inactive-self={selfInactive ? "true" : "false"}
    >
      <div className={`${styles.banner} ${selfInactive ? styles.self : styles.opponent}`}>
        <span
          className={styles.title}
          dir={locale === "he" ? "rtl" : "ltr"}
          lang={locale}
        >
          {selfInactive ? t("game.inactivityYouInactive") : t("game.inactivityWaitingForOpponent")}
        </span>
        <span
          className={styles.subtitle}
          dir={locale === "he" ? "rtl" : "ltr"}
          lang={locale}
        >
          {selfInactive ? t("game.inactivityMakeMove") : t("game.inactivityOpponentInactive")}
        </span>
        <span
          className={styles.label}
          dir={locale === "he" ? "rtl" : "ltr"}
          lang={locale}
        >
          {selfInactive ? t("game.inactivityLossIn") : t("game.inactivityWinIn")}
        </span>
        <span className={styles.countdown} role="timer">
          {formatCountdown(remaining)}
        </span>
      </div>
    </div>
  );
}
