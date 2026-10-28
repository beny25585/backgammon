import { useEffect, useState } from "react";
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
  layout?: "strip" | "rail";
}

const DISPLAY_TICK_MS = 250;

export default function Clock({
  clock,
  activeColor,
  myColor,
  myLabel,
  oppLabel,
  delayMs = 0,
  turnStartedAt,
  layout = "strip",
}: ClockProps) {
  const { t } = useI18n();
  const oppColor: Color = myColor === "white" ? "black" : "white";
  const myActive = activeColor === myColor;
  const oppActive = activeColor === oppColor;

  // Display-only countdown: extrapolate from the last authoritative value so the
  // numbers keep moving between server updates. The server (or local hook) owns
  // the real clock; this never decides anything.
  const [now, setNow] = useState(() => turnStartedAt ?? 0);
  const [fallbackStartedAt, setFallbackStartedAt] = useState<number | null>(
    null,
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!activeColor || turnStartedAt != null) {
        setFallbackStartedAt(null);
        return;
      }
      setFallbackStartedAt(Date.now());
    }, 0);
    return () => window.clearTimeout(id);
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
  const showDelay = delayMs > 0;

  const myLow = myValue != null && myValue <= 10_000;
  const oppLow = oppValue != null && oppValue <= 10_000;

  const rail = layout === "rail";
  const sideClass = "flex min-h-[clamp(28px,5.1cqh,50px)] min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 tabular-nums [@container_game-layout_(height<500px)]:min-h-7 [@container_game-layout_(height<500px)]:py-1";
  const timeClass = "text-[clamp(15px,18cqw,28px)] font-medium leading-none tracking-tight [@container_game-layout_(height<500px)]:text-base";
  const activeClass = "border-2 border-[#e1be73] bg-black/10 text-[#f0ce85]";
  const idleClass = "border-white/20 bg-white/3 text-[#f1ebdf]";
  const lowClass = "low border-rose-400/70 bg-rose-400/8 text-rose-300";
  const myCls = `${sideClass} ${rail ? "col-start-1 row-start-5" : ""} ${myActive ? "myActive" : "idle"} ${myLow ? lowClass : myActive ? activeClass : idleClass}`;
  const oppCls = `${sideClass} ${rail ? "col-start-1 row-start-2" : ""} ${oppActive ? "oppActive" : "idle"} ${oppLow ? lowClass : oppActive ? activeClass : idleClass}`;

  return (
    <div className={rail ? "contents" : "grid min-w-0 grid-flow-col auto-cols-fr gap-1"}>
      <div className={oppCls} data-testid="clock-opp">
        <span className={rail ? "sr-only" : "max-w-full truncate text-xs"}>{oppLabel}</span>
        <span className={timeClass} dir="ltr">{formatClock(oppValue)}</span>
      </div>
      {showDelay && (
        <div className={`flex min-w-0 items-center justify-center gap-2 text-[#c8bda8] ${rail ? "col-start-1 row-start-3 self-end border-t border-white/10 py-2" : "flex-col px-1"}`} data-testid="clock-delay">
          <span className="text-[clamp(9px,5cqw,12px)]">{t("common.delay")}</span>
          <span className="text-sm font-semibold tabular-nums text-[#f0ce85]" dir="ltr">{formatSeconds(delayMsLeft)}</span>
        </div>
      )}
      <div className={myCls} data-testid="clock-my">
        <span className={rail ? "sr-only" : "max-w-full truncate text-xs"}>{myLabel}</span>
        <span className={timeClass} dir="ltr">{formatClock(myValue)}</span>
      </div>
    </div>
  );
}

function formatSeconds(ms: number): string {
  return String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, "0");
}
