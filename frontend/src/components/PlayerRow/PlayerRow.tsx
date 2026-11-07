import type { GameState, Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";
import type { PlayerDetails } from "../../types/playerDetails";
import PlayerMetrics from "./PlayerMetrics";
import PlayerScore from "./PlayerScore";

interface PlayerRowProps {
  color: Color;
  state: GameState;
  label: string;
  active: boolean;
  self: boolean;
  score?: number;
  details?: PlayerDetails | null;
  showScore?: boolean;
}

export default function PlayerRow({
  color,
  state,
  label,
  active,
  self,
  score,
  details,
  showScore = true,
}: PlayerRowProps) {
  const { t } = useI18n();
  const initials = label.trim().slice(0, 2).toUpperCase();
  const turnLabel = active ? t(self ? "common.yourTurn" : "common.theirTurn") : null;

  return (
    <div
      className={`group/player relative isolate grid w-full min-w-0 items-center justify-items-center gap-1.5 py-1 text-center text-[#f7f1e7] data-[active=true]:text-[#f0ce8c] @min-[1200px]/game-layout:py-0 [@container_game-frame_(height<700px)]:gap-x-1.5 [@container_game-frame_(height<700px)]:gap-y-0 [@container_game-frame_(height<700px)]:py-0 ${showScore ? "[@container_game-frame_(height<700px)]:grid-cols-[minmax(0,1fr)_28px]" : ""}`}
      data-player={self ? "self" : "opponent"}
      data-active={active}
      role="group"
      aria-label={t(self ? "common.you" : "common.opponent")}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-[16%] start-0 w-0.5 rounded-full bg-[#e4b96d] opacity-0 motion-safe:transition-opacity motion-safe:duration-[120ms] motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[active=true]/player:opacity-100" />
      <div className={`relative flex w-full min-w-0 flex-col items-center gap-1.5 [@container_game-frame_(height<700px)]:col-start-1 ${turnLabel && showScore ? "[@container_game-frame_(height<700px)]:row-start-1" : "[@container_game-frame_(height<700px)]:[grid-row:1/span_2]"}`}>
        <div className="flex w-full min-w-0 flex-col-reverse items-center gap-1.5">
          <span
            className="block w-full truncate text-[clamp(11px,10cqw,17px)] font-bold leading-tight [@container_game-frame_(height<700px)]:px-0.5 [@container_game-frame_(height<700px)]:text-[11px]"
            data-testid={`player-name-${color}`}
            title={label}
          >
            <bdi>{label}</bdi>
          </span>
          <span
            aria-hidden="true"
            data-active={active}
            className="relative grid size-[clamp(30px,min(56cqw,10cqh),96px)] shrink-0 place-items-center rounded-full border border-[#bfa16b]/55 [background:radial-gradient(ellipse_at_36%_24%,#ffffff16,transparent_70%),var(--ui-secondary-bg,#241b14)] text-[clamp(14px,16cqw,28px)] font-bold text-[#f1ebdf] shadow-[inset_0_1px_0_#ffe2b024,0_2px_5px_#0006] data-[active=true]:border-[#d6b279]/80 [@container_game-frame_(height<700px)]:hidden"
          >
            {initials}
            <span
              className={`absolute right-[3%] bottom-[3%] size-[clamp(10px,9cqw,19px)] rounded-full border border-[#c8a66a] ring-2 ring-[color:var(--ui-secondary-bg,#201710)] shadow-sm ${color === "white" ? "bg-linear-to-br from-[var(--lux-checker-light-hi,#fff8e5)] to-[var(--lux-checker-light-low,#c2a576)]" : "bg-linear-to-br from-[var(--lux-checker-dark-hi,#533b2a)] to-[var(--lux-checker-dark-low,#140e0b)]"}`}
            />
          </span>
        </div>
        {details && <div className="w-full"><PlayerMetrics details={details} color={color} /></div>}
      </div>
      {showScore && (
        <div className="grid w-full min-w-0 place-items-center [@container_game-frame_(height<700px)]:col-start-2 [@container_game-frame_(height<700px)]:[grid-row:1/span_2]">
          <PlayerScore color={color} label={label} score={score ?? 0} />
        </div>
      )}
      {turnLabel && (
        <span className={showScore
          ? "w-fit max-w-full truncate rounded-full border border-[#d3ad70]/35 bg-[#d3ad70]/14 px-2 py-[3px] text-[clamp(11px,7cqw,12px)] font-bold leading-tight text-[#f2d096] [@container_game-frame_(height<700px)]:col-start-1 [@container_game-frame_(height<700px)]:row-start-2 [@container_game-frame_(height<700px)]:border-0 [@container_game-frame_(height<700px)]:bg-transparent [@container_game-frame_(height<700px)]:p-0 [@container_game-frame_(height<700px)]:text-[9px]"
          : "sr-only"} title={turnLabel}>
          {turnLabel}
        </span>
      )}
      <span className="sr-only">
        {t("common.off", { count: state.home[color] })} ·{" "}
        {t("common.bar", { count: state.bar[color] })}
      </span>
    </div>
  );
}
