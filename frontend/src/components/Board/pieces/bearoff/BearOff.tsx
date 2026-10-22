import type { GameState, Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../../../i18n/I18nProvider";

interface BearOffProps {
  state: GameState;
  myColor: Color | null;
  isLegalTarget: boolean;
  onClick: () => void;
  onControlsTargetChange?: (target: HTMLDivElement | null) => void;
}

function BearOffTray({
  color,
  count,
  bottom,
  legal,
  label,
  actionLabel,
  onClick,
}: {
  color: Color;
  count: number;
  bottom: boolean;
  legal: boolean;
  label: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!legal}
      className={`relative flex min-h-0 min-w-0 gap-[clamp(2px,0.8cqh,4px)] overflow-hidden rounded-lg border border-[var(--ui-accent-border,#d6ae6380)] bg-black/15 p-[clamp(2px,0.8cqh,4px)] shadow-[inset_0_2px_5px_#00000040,0_1px_0_#ffffff14] outline-offset-2 focus-visible:outline-2 focus-visible:outline-amber-300 enabled:cursor-pointer data-[legal=true]:border-amber-200 data-[legal=true]:bg-[var(--ui-accent-soft,#d6ae633d)] data-[legal=true]:ring-1 data-[legal=true]:ring-inset data-[legal=true]:ring-amber-200/60 ${bottom ? "row-start-3 flex-col-reverse" : "row-start-1 flex-col"}`}
      data-testid={bottom ? "bear-off-bottom" : "bear-off-top"}
      data-point-idx="off"
      data-color={color}
      data-legal={legal}
      title={label}
      aria-label={legal ? `${label}. ${actionLabel}` : label}
    >
      <span
        aria-hidden="true"
        data-borne-off-count={color}
        className={`grid h-[clamp(14px,4cqh,24px)] w-full shrink-0 place-items-center rounded-sm border text-[clamp(10px,2.5cqh,14px)] leading-none font-bold tabular-nums shadow-sm ${color === "white" ? "border-[var(--lux-checker-light-border,#b88f4f)] bg-[var(--lux-checker-light-mid,#fff4d4)] text-[#2b2118]" : "border-white/25 bg-[var(--lux-checker-dark-deep,#4a0c13)] text-white"}`}
      >
        {count}
      </span>
      <span
        aria-hidden="true"
        data-borne-off-stack
        className={`flex min-h-0 w-full flex-1 gap-[clamp(0px,calc((100cqh-300px)*0.01),1px)] [--bearoff-piece-max:12px] ${bottom ? "flex-col-reverse" : "flex-col"}`}
      >
        {Array.from({ length: Math.min(count, 15) }, (_, index) => (
          <span
            key={index}
            data-borne-off-checker={color}
            className={`min-h-0 max-h-[var(--bearoff-piece-max)] w-full flex-1 rounded-[3px] shadow-[inset_0_1px_1px_#ffffff45,inset_0_-1px_1px_#00000040] ${color === "white" ? "bg-linear-to-b from-[var(--lux-checker-light-mid,#fff4d4)] to-[var(--lux-checker-light-low,#c7a874)]" : "bg-linear-to-b from-[var(--lux-checker-dark-mid,#a5383f)] to-[var(--lux-checker-dark-deep,#4a0c13)]"}`}
          />
        ))}
      </span>
    </button>
  );
}

export default function BearOff({ state, myColor, isLegalTarget, onClick, onControlsTargetChange }: BearOffProps) {
  const { t } = useI18n();
  const bottomBearOffColor: Color = myColor ?? "white";
  const topBearOffColor: Color = bottomBearOffColor === "white" ? "black" : "white";

  return (
    <div
      className="relative col-start-4 row-start-1 grid h-full min-h-0 w-[var(--bearoff-w)] shrink-0 grid-rows-[minmax(44px,1fr)_auto_minmax(44px,1fr)] gap-1 px-0.5 py-1 [container-type:size] [background:var(--lux-bearoff-bg,var(--lux-rail-bg,#171b19))] shadow-[inset_1px_0_#ffffff14,inset_-1px_0_#00000030]"
      data-testid="bear-off-column"
      role="group"
      aria-label={t("game.bearOffSummary", {
        white: state.home.white,
        black: state.home.black,
      })}
    >
        <BearOffTray
          color={topBearOffColor}
          count={state.home[topBearOffColor]}
          bottom={false}
          legal={isLegalTarget && state.turn === topBearOffColor}
          label={t("game.bearOffPlayer", {
            color: t(topBearOffColor === "white" ? "common.white" : "common.black"),
            count: state.home[topBearOffColor],
          })}
          actionLabel={t("game.bearOffAction")}
          onClick={onClick}
        />
        <div
          ref={onControlsTargetChange}
          className="relative row-start-2 flex max-h-[max(44px,min(60cqh,calc(100cqh-96px)))] min-h-0 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:none] touch-auto empty:hidden"
          data-testid="game-controls"
        />
        <BearOffTray
          color={bottomBearOffColor}
          count={state.home[bottomBearOffColor]}
          bottom
          legal={isLegalTarget && state.turn === bottomBearOffColor}
          label={t("game.bearOffPlayer", {
            color: t(bottomBearOffColor === "white" ? "common.white" : "common.black"),
            count: state.home[bottomBearOffColor],
          })}
          actionLabel={t("game.bearOffAction")}
          onClick={onClick}
        />
    </div>
  );
}
