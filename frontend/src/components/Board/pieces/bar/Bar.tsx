import type { GameState, Color } from "@/lib/backgammon/engine";
import { pipCount } from "@/lib/backgammon/engine";
import type { ReactNode } from "react";
import Checker from "../checker/Checker";
import BoardCount from "../BoardCount";
import { useI18n } from "../../../../i18n/I18nProvider";
import { useBoardMaterials } from "../../materials/boardMaterialContext";
import { BAR_CHECKER_LIMIT, barStackOffset, type BarStackMetrics } from "../../checkerStackGeometry";

interface BarProps {
  state: GameState;
  myColor: Color | null;
  selected: boolean;
  isLegalFrom: boolean;
  hideChecker?: "white" | "black" | null;
  pendingCaptures?: { color: Color; count: number };
  doublingCube?: ReactNode;
  cubePosition?: "top" | "center" | "bottom";
  checkerLayout?: BarStackMetrics | null;
  onClick: () => void;
}

const stackSlots = ["top-0", "top-1/2 -translate-y-1/2", "bottom-0"];

function BarStack({ count, color, top, hiddenTop, selected, layout }: {
  count: number; color: Color; top: boolean; hiddenTop: boolean; selected: boolean; layout?: BarStackMetrics | null;
}) {
  const displayedCount = Math.min(count, BAR_CHECKER_LIMIT);
  const renderCount = Math.max(0, displayedCount - (hiddenTop ? 1 : 0));
  return (
    <div
      className={`absolute inset-x-0 z-2 h-[18%] ${top ? "top-[29%]" : "bottom-[29%]"}`}
      data-testid={`bar-checkers-${color}`}
      data-bar-checker-stack
    >
      {Array.from({ length: renderCount }).map((_, index) => {
        const slot = displayedCount === 1 ? 1 : displayedCount === 2 ? index * 2 : index;
        return (
          <div key={index} className={`absolute left-1/2 -translate-x-1/2 ${layout ? "" : stackSlots[slot]}`}
            style={layout ? { top: barStackOffset(layout, displayedCount, index) } : undefined}>
            <Checker color={color} size={layout?.diameter} selected={selected && !hiddenTop && index === renderCount - 1}
              label={index === displayedCount - 1 && count > BAR_CHECKER_LIMIT ? String(count) : undefined} />
          </div>
        );
      })}
    </div>
  );
}

function PipMeter({ count, color, side }: { count: number; color: Color; side: "self" | "opponent" }) {
  const { ready: materialReady } = useBoardMaterials();
  return (
    <span
      className={`pointer-events-none absolute inset-x-[14%] z-10 -translate-y-1/2 overflow-hidden rounded-[3px] border py-[clamp(3px,0.45cqw,5px)] text-center text-[clamp(9px,calc(var(--bar-display-width)*0.28),16px)] leading-none font-semibold tabular-nums text-[var(--board-meter-text,#ead3a2)] ${materialReady ? "border-[var(--board-meter-border,#b39b6b55)] bg-linear-to-b from-[var(--board-meter-bg,#141919)] to-[#060909] shadow-[inset_0_2px_3px_#000000dd,inset_0_-1px_0_#ffffff11]" : "border-[var(--board-meter-border,#000000cc)] bg-[var(--board-meter-bg,#070a0b)] shadow-[0_1px_0_#ffffff24,inset_1px_2px_3px_#000000cc,inset_-1px_-1px_0_#ffffff0a]"} ${side === "opponent" ? "top-[18%]" : "top-[82%]"}`}
      data-testid={`bar-pip-${color}`}
      data-player-side={side}
    >
      {materialReady && <span aria-hidden="true" className="pointer-events-none absolute inset-[1px] rounded-[1px] border border-t-black/65 border-l-black/50 border-r-white/5 border-b-white/10" />}
      <BoardCount count={count} className={materialReady ? "relative [text-shadow:0_1px_1px_#000000]" : undefined} />
    </span>
  );
}

export default function Bar({
  state,
  myColor,
  selected,
  isLegalFrom,
  hideChecker,
  pendingCaptures,
  doublingCube,
  cubePosition = "center",
  checkerLayout,
  onClick,
}: BarProps) {
  const { t } = useI18n();
  const { ready: materialReady } = useBoardMaterials();
  const bottomColor = myColor ?? "white";
  const topColor = bottomColor === "white" ? "black" : "white";
  return (
    <button type="button" onClick={onClick} className={`relative col-start-2 row-start-1 h-full [--bar-display-width:max(26px,var(--bar-w))] w-[var(--bar-display-width)] cursor-pointer rounded-sm border-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${materialReady ? "bg-transparent" : "shadow-[inset_2px_0_2px_#000000f2,inset_-2px_0_2px_#000000cc] [background:var(--lux-bar-bg,#071034)]"}`} data-point-idx="bar" aria-label={t("game.barSummary", { black: state.bar.black, white: state.bar.white })}>
      {!materialReady && <>
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-[3px] inset-y-[2px] rounded-[2px] shadow-[inset_1px_1px_0_#ffffff26,inset_-2px_-2px_0_#000000b3,inset_0_0_0_1px_#000000cc] [background:linear-gradient(135deg,#ffffff0d,transparent_45%,#00000014),var(--lux-bar-bg,#071034)]" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-[5px] rounded-[inherit] opacity-[var(--lux-board-texture-opacity,0)] mix-blend-soft-light [background:var(--lux-board-texture-layer,var(--lux-board-texture,none)_0_0/480px_480px)]" />
      </>}
      {(selected || isLegalFrom) && (
        <span aria-hidden="true" className={`pointer-events-none absolute inset-[2px] z-1 rounded-sm border border-amber-100/50 motion-safe:transition-opacity motion-safe:duration-[120ms] motion-safe:starting:opacity-0 ${selected ? "bg-amber-200/15" : "bg-amber-200/5"}`} />
      )}

      <PipMeter count={pipCount(state, topColor)} color={topColor} side="opponent" />

      {doublingCube && (
        <div className={`pointer-events-none absolute inset-0 z-4 motion-safe:transition-transform motion-safe:duration-[220ms] motion-safe:ease-[cubic-bezier(0.77,0,0.175,1)] ${cubePosition === "top" ? "-translate-y-[38%]" : cubePosition === "bottom" ? "translate-y-[38%]" : ""}`}>
          <div
            className="absolute top-1/2 left-1/2 -translate-1/2 [--board-cube-size:var(--board-bar-cube-size,clamp(28px,4.2cqw,42px))]"
            data-cube-position={cubePosition}
            data-testid="bar-doubling-cube"
          >
            {doublingCube}
          </div>
        </div>
      )}

      <BarStack count={state.bar[topColor] - (pendingCaptures?.color === topColor ? pendingCaptures.count : 0)} color={topColor} top hiddenTop={hideChecker === topColor} selected={selected && state.turn === topColor} layout={checkerLayout} />
      <BarStack count={state.bar[bottomColor] - (pendingCaptures?.color === bottomColor ? pendingCaptures.count : 0)} color={bottomColor} top={false} hiddenTop={hideChecker === bottomColor} selected={selected && state.turn === bottomColor} layout={checkerLayout} />

      <PipMeter count={pipCount(state, bottomColor)} color={bottomColor} side="self" />
    </button>
  );
}
