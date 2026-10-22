import type { GameState, Color } from "@/lib/backgammon/engine";
import { pipCount } from "@/lib/backgammon/engine";
import type { ReactNode } from "react";
import Checker from "../checker/Checker";
import styles from "./Bar.module.css";
import { useI18n } from "../../../../i18n/I18nProvider";

interface BarProps {
  state: GameState;
  myColor: Color | null;
  selected: boolean;
  isLegalFrom: boolean;
  hideChecker?: "white" | "black" | null;
  doublingCube?: ReactNode;
  cubePosition?: "top" | "center" | "bottom";
  onClick: () => void;
}

const stackSlots = ["top-0", "top-1/2 -translate-y-1/2", "bottom-0"];

function BarStack({ count, color, top }: { count: number; color: Color; top: boolean }) {
  return (
    <div
      className={`absolute inset-x-0 z-2 h-[18%] ${top ? "top-[29%]" : "bottom-[29%]"}`}
      data-testid={`bar-checkers-${color}`}
    >
      {Array.from({ length: Math.min(count, 3) }).map((_, index, slots) => {
        const slot = slots.length === 1 ? 1 : slots.length === 2 ? index * 2 : index;
        return (
          <div key={index} className={`absolute left-1/2 -translate-x-1/2 ${stackSlots[slot]}`}>
            <Checker color={color} label={index === slots.length - 1 && count > 3 ? String(count) : undefined} />
          </div>
        );
      })}
    </div>
  );
}

export default function Bar({
  state,
  myColor,
  selected,
  isLegalFrom,
  hideChecker,
  doublingCube,
  cubePosition = "center",
  onClick,
}: BarProps) {
  const { t } = useI18n();
  const bottomColor = myColor ?? "white";
  const topColor = bottomColor === "white" ? "black" : "white";
  const visibleCount = (color: Color) => Math.max(state.bar[color] - (hideChecker === color ? 1 : 0), 0);
  return (
    <button type="button" onClick={onClick} className="relative h-full [--bar-display-width:max(26px,var(--bar-w))] w-[var(--bar-display-width)] cursor-pointer border-0 [background:var(--lux-bar-bg,#071034)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300" data-point-idx="bar" aria-label={t("game.barSummary", { black: state.bar.black, white: state.bar.white })}>
      {(selected || isLegalFrom) && <div className={styles.highlight} />}

      <span
        className="pointer-events-none absolute inset-x-0.5 top-[18%] z-10 -translate-y-1/2 rounded-sm bg-black/85 py-1 text-center font-mono text-[clamp(9px,calc((var(--bar-display-width)-4px)*0.54),16px)] leading-none font-bold tabular-nums text-white"
        data-testid={`bar-pip-${topColor}`}
        data-player-side="opponent"
      >
        {pipCount(state, topColor)}
      </span>

      {doublingCube && (
        <div
          className={styles.cubeSlot}
          data-cube-position={cubePosition}
          data-testid="bar-doubling-cube"
        >
          {doublingCube}
        </div>
      )}

      <BarStack count={visibleCount(topColor)} color={topColor} top />
      <BarStack count={visibleCount(bottomColor)} color={bottomColor} top={false} />

      <span
        className="pointer-events-none absolute inset-x-0.5 top-[82%] z-10 -translate-y-1/2 rounded-sm bg-black/85 py-1 text-center font-mono text-[clamp(9px,calc((var(--bar-display-width)-4px)*0.54),16px)] leading-none font-bold tabular-nums text-white"
        data-testid={`bar-pip-${bottomColor}`}
        data-player-side="self"
      >
        {pipCount(state, bottomColor)}
      </span>
    </button>
  );
}
