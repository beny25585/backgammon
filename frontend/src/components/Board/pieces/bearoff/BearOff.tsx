import type { GameState, Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../../../i18n/I18nProvider";
import { useBoardMaterials } from "../../materials/boardMaterialContext";

interface BearOffProps {
  state: GameState;
  myColor: Color | null;
  isLegalTarget: boolean;
  onClick: () => void;
  onControlsTargetChange?: (target: HTMLDivElement | null) => void;
}

function TrayRecess({ bottom }: { bottom: boolean }) {
  const { ready: materialReady } = useBoardMaterials();
  return (
    <span
      aria-hidden="true"
      data-bearoff-layer="rim"
      className={`pointer-events-none absolute inset-x-0 overflow-hidden rounded-[9px] border border-[var(--lux-rail-border,var(--ui-accent-border,#d6ae6380))] [background:var(--lux-rail-bg,#171b19)] shadow-[inset_2px_2px_1px_#ffffff42,inset_-3px_-3px_2px_#000000e6,0_2px_4px_#000000cc] group-data-[legal=true]:border-amber-100 ${materialReady ? "invisible" : ""} ${bottom ? "top-[var(--bearoff-tray-gap)] bottom-0" : "top-0 bottom-[var(--bearoff-tray-gap)]"}`}
    >
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-br from-white/15 via-transparent to-black/55" />
      <span
        data-bearoff-layer="wall"
        className="pointer-events-none absolute inset-[3px] rounded-[6px] border border-black/80 bg-black/80 shadow-[inset_3px_4px_4px_#000000,inset_-1px_-1px_0_#ffffff24]"
      />
      <span
        data-bearoff-layer="floor"
        className="pointer-events-none absolute inset-[6px] overflow-hidden rounded-[3px] border border-black/60 [background:var(--lux-bearoff-bg,var(--lux-rail-bg,#171b19))] shadow-[inset_3px_5px_8px_#000000e6,inset_-1px_-1px_2px_#ffffff0d]"
      >
        <span className="pointer-events-none absolute inset-0 opacity-[var(--lux-board-texture-opacity,0.5)] mix-blend-soft-light [background-image:var(--lux-board-texture,none)] bg-size-[160px_160px]" />
        <span className="pointer-events-none absolute inset-0 bg-linear-to-br from-black/45 via-black/15 to-black/30" />
      </span>
    </span>
  );
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
      className={`group relative isolate flex min-h-0 min-w-0 gap-[clamp(2px,0.8cqh,4px)] overflow-hidden rounded-[10px] border border-transparent bg-transparent p-[clamp(4px,0.8cqh,6px)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-amber-300 enabled:cursor-pointer data-[legal=true]:border-amber-200 data-[legal=true]:ring-1 data-[legal=true]:ring-inset data-[legal=true]:ring-amber-200/60 ${bottom ? "row-start-3 flex-col-reverse pt-[calc(clamp(4px,0.8cqh,6px)_+_var(--bearoff-tray-gap))]" : "row-start-1 flex-col pb-[calc(clamp(4px,0.8cqh,6px)_+_var(--bearoff-tray-gap))]"}`}
      data-testid={bottom ? "bear-off-bottom" : "bear-off-top"}
      data-point-idx="off"
      data-color={color}
      data-legal={legal}
      title={label}
      aria-label={legal ? `${label}. ${actionLabel}` : label}
    >
      <TrayRecess bottom={bottom} />
      <span
        aria-hidden="true"
        data-borne-off-count={color}
        className="relative z-10 -mx-[3px] grid h-[clamp(18px,4cqh,30px)] w-[calc(100%_+_6px)] shrink-0 place-items-center overflow-hidden rounded-[4px] border border-[var(--lux-rail-border,var(--ui-accent-border,#d6ae6380))] [background:var(--lux-rail-bg,#171b19)] text-[clamp(11px,2.5cqh,17px)] leading-none font-bold text-[var(--board-bearoff-count-text,var(--lux-checker-light-hi,#fff2d2))] tabular-nums shadow-[inset_1px_1px_0_#ffffff35,inset_-2px_-2px_1px_#000000b3,0_1px_0_#ffffff12]"
      >
        <span className="pointer-events-none absolute inset-[2px] rounded-[2px] border border-black/75 bg-black/70 shadow-[inset_1px_2px_3px_#000000e6,inset_-1px_-1px_0_#ffffff0d]" />
        <span className="relative">{count}</span>
      </span>
      <span
        aria-hidden="true"
        data-borne-off-stack
        className={`relative z-10 flex min-h-0 w-full flex-1 gap-[clamp(0px,calc(1cqh_-_3px),1px)] [--bearoff-piece-max:12px] ${bottom ? "flex-col-reverse" : "flex-col"}`}
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
  const { ready: materialReady } = useBoardMaterials();
  const bottomBearOffColor: Color = myColor ?? "white";
  const topBearOffColor: Color = bottomBearOffColor === "white" ? "black" : "white";

  return (
    <div
      className={`relative col-start-4 row-start-1 grid h-full min-h-0 w-[var(--bearoff-w)] shrink-0 grid-rows-[minmax(44px,1fr)_auto_minmax(44px,1fr)] gap-1 px-0.5 py-1 [--bearoff-tray-gap:clamp(0px,calc(2cqh_-_6px),10px)] [container-type:size] ${materialReady ? "bg-transparent" : "[background:var(--lux-bearoff-bg,var(--lux-rail-bg,#171b19))] shadow-[inset_1px_0_#ffffff14,inset_-1px_0_#00000030]"}`}
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
