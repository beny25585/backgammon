import { useEffect, useState } from "react";
import styles from "./Clock.module.css";
import { formatClock, delayLeft } from "../../lib/clock";
import type { Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";

interface ClockProps {
  clock: Record<Color, number> | null | undefined;
  activeColor: Color | null;
  myColor: Color;
  myLabel: string;
  oppLabel: string;
  delayMs?: number;
  turnStartedAt?: number | null;
}

const DISPLAY_TICK_MS = 250;

export default function Clock({ clock, activeColor, myColor, myLabel, oppLabel, delayMs = 0, turnStartedAt }: ClockProps) {
  const { t } = useI18n();
  const oppColor: Color = myColor === "white" ? "black" : "white";
  const myActive = activeColor === myColor;
  const oppActive = activeColor === oppColor;

  // Display-only countdown: extrapolate from the last authoritative value so the
  // numbers keep moving between server updates. The server (or local hook) owns
  // the real clock; this never decides anything.
  const [now, setNow] = useState(() => turnStartedAt ?? 0);
  const [fallbackStartedAt, setFallbackStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!activeColor || turnStartedAt != null) {
      setFallbackStartedAt(null);
      return;
    }
    setFallbackStartedAt(Date.now());
  }, [activeColor, turnStartedAt]);

  useEffect(() => {
    if (!activeColor) return;
    const id = setInterval(() => setNow(Date.now()), DISPLAY_TICK_MS);
    return () => clearInterval(id);
  }, [activeColor]);

  const effectiveTurnStartedAt = turnStartedAt ?? fallbackStartedAt;

  // The active player's reserve only drains beyond the per-turn delay.
  function displayValue(color: Color, active: boolean): number | null {
    if (!clock || clock[color] == null) return null;
    if (!active) return clock[color];
    const charged =
      effectiveTurnStartedAt != null
        ? Math.max(0, now - effectiveTurnStartedAt - delayMs)
        : 0;
    return Math.max(0, clock[color] - charged);
  }

  const myValue = displayValue(myColor, myActive);
  const oppValue = displayValue(oppColor, oppActive);

  const delayMsLeft = activeColor
    ? delayLeft(activeColor, effectiveTurnStartedAt, now, delayMs)
    : 0;
  const showDelay = delayMs > 0 && delayMsLeft > 0;

  const myLow = myValue != null && myValue <= 10_000;
  const oppLow = oppValue != null && oppValue <= 10_000;

  const myCls = `${styles.side} ${myActive ? styles.myActive : styles.idle} ${myLow ? styles.low : ""}`;
  const oppCls = `${styles.side} ${oppActive ? styles.oppActive : styles.idle} ${oppLow ? styles.low : ""}`;

  return (
    <div className={styles.strip}>
      <div className={myCls} data-testid="clock-my">
        <span className={styles.label}>{myLabel}</span>
        <span className={styles.time}>{formatClock(myValue)}</span>
      </div>
      {showDelay && (
        <div className={styles.delay} data-testid="clock-delay">
          <span className={styles.delayLabel}>{t("common.delay")}</span>
          <span className={styles.seconds}>{formatSeconds(delayMsLeft)}</span>
        </div>
      )}
      <div className={oppCls} data-testid="clock-opp">
        <span className={styles.label}>{oppLabel}</span>
        <span className={styles.time}>{formatClock(oppValue)}</span>
      </div>
    </div>
  );
}

function formatSeconds(ms: number): string {
  return String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, "0");
}
