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
  layout?: "strip" | "rail" | "stacked";
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
  const stacked = layout === "stacked";
  const sideClass = `flex min-h-[clamp(28px,5.1cqh,50px)] min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 tabular-nums [@container_game-frame_(height<700px)]:min-h-7 [@container_game-frame_(height<700px)]:py-1 ${stacked ? "[@container_game-frame_(height<700px)]:flex-row [@container_game-frame_(height<700px)]:justify-between [@container_game-frame_(height<700px)]:px-2" : ""}`;
  const timeClass = `text-[clamp(15px,18cqw,28px)] font-bold leading-none tracking-tight [@container_game-frame_(height<700px)]:text-base ${stacked ? "shrink-0" : ""}`;
  const activeClass = "border-2 border-emerald-300 bg-[#10291e] text-emerald-200";
  const idleClass = "border-[#c8a85f] bg-[#211b10] text-[#ffe29a]";
  const lowClass = "low border-red-400/80 bg-[#301517] text-red-300";
  const myCls = `${sideClass} ${rail ? "col-start-1 row-start-5" : ""} ${myActive ? "myActive" : "idle"} ${myLow ? lowClass : myActive ? activeClass : idleClass}`;
  const oppCls = `${sideClass} ${rail ? "col-start-1 row-start-2" : ""} ${oppActive ? "oppActive" : "idle"} ${oppLow ? lowClass : oppActive ? activeClass : idleClass}`;

  return (
    <div className={rail ? "contents" : stacked ? "grid min-w-0 grid-cols-1 gap-1" : "grid min-w-0 grid-flow-col auto-cols-fr gap-1"}>
      <div className={oppCls} data-testid="clock-opp">
        <span className={rail ? "sr-only" : "max-w-full truncate text-xs"}>{oppLabel}</span>
        <span className={timeClass} dir="ltr">{formatClock(oppValue)}</span>
      </div>
      {showDelay && (
        <div className={`flex min-w-0 items-center justify-center gap-2 text-[#c8bda8] ${rail ? "col-start-1 row-start-3 self-end border-t border-white/10 py-2 [@container_game-frame_(height<700px)]:py-0" : stacked ? "px-1 py-0.5" : "flex-col px-1"}`} data-testid="clock-delay">
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
