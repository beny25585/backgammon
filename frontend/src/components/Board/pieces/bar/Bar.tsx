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

function BarStack({ count, color }: { count: number; color: Color }) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-2 h-[18%] ${color === "black" ? "top-[29%]" : "bottom-[29%]"}`}
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
  selected,
  isLegalFrom,
  hideChecker,
  doublingCube,
  cubePosition = "center",
  onClick,
}: BarProps) {
  const { t } = useI18n();
  const blackCount = Math.max(state.bar.black - (hideChecker === "black" ? 1 : 0), 0);
  const whiteCount = Math.max(state.bar.white - (hideChecker === "white" ? 1 : 0), 0);
  return (
    <button type="button" onClick={onClick} className="relative h-full w-[var(--bar-w)] cursor-pointer border-0 [background:var(--lux-bar-bg,#071034)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300" data-point-idx="bar" aria-label={t("game.barSummary", { black: state.bar.black, white: state.bar.white })}>
      {(selected || isLegalFrom) && <div className={styles.highlight} />}

      <span
        className="pointer-events-none absolute inset-x-0 top-[18%] z-10 -translate-y-1/2 rounded bg-black/85 py-0.5 text-center text-[clamp(14px,2.1cqw,22px)] leading-none font-black text-white"
        data-testid="bar-pip-black"
      >
        {pipCount(state, "black")}
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

      <BarStack count={blackCount} color="black" />
      <BarStack count={whiteCount} color="white" />

      <span
        className="pointer-events-none absolute inset-x-0 top-[82%] z-10 -translate-y-1/2 rounded bg-black/85 py-0.5 text-center text-[clamp(14px,2.1cqw,22px)] leading-none font-black text-white"
        data-testid="bar-pip-white"
      >
        {pipCount(state, "white")}
      </span>
    </button>
  );
}
