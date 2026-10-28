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

  return (
    <div
      className="flex w-full min-w-0 flex-col items-center gap-2 py-1 text-center text-[#f7f1e7] data-[active=true]:text-[#e6c478] @min-[1200px]/game-layout:py-0 [@container_game-layout_(height<500px)]:grid [@container_game-layout_(height<500px)]:grid-cols-[minmax(0,1fr)_32px] [@container_game-layout_(height<500px)]:gap-0.5 [@container_game-layout_(height<500px)]:py-0.5"
      data-player={self ? "self" : "opponent"}
      data-active={active}
      role="group"
      aria-label={t(self ? "common.you" : "common.opponent")}
    >
      <div className="relative flex w-full min-w-0 flex-col items-center gap-2 @min-[1200px]/game-layout:items-start">
        <div className="flex w-full min-w-0 flex-col-reverse items-center gap-2.5 @min-[1200px]/game-layout:w-[100px]">
          <span
            className="block w-full truncate text-[clamp(11px,13cqw,22px)] font-bold leading-tight"
            data-testid={`player-name-${color}`}
            title={label}
          >
            <bdi>{label}</bdi>
          </span>
          <span
            aria-hidden="true"
            data-active={active}
            className="relative grid size-[clamp(30px,min(56cqw,10cqh),96px)] shrink-0 place-items-center rounded-full border border-[#bfa16b]/75 bg-linear-to-br from-[#252a2b] to-[#111516] text-[clamp(14px,20cqw,34px)] font-bold text-[#f1ebdf] data-[active=true]:border-[3px] data-[active=true]:border-[#e6c478] data-[active=true]:text-[#e6c478] [@container_game-layout_(height<500px)]:hidden"
          >
            {initials}
            <span
              className={`absolute bottom-0 right-0 size-[clamp(10px,9cqw,19px)] rounded-full border border-[#c8a66a] shadow-sm ${color === "white" ? "bg-linear-to-br from-[#fff8e5] to-[#c2a576]" : "bg-linear-to-br from-[#34393b] to-[#030506]"}`}
            />
          </span>
        </div>
        {details && <div className="w-full @min-[1200px]/game-layout:w-[100px]"><PlayerMetrics details={details} color={color} /></div>}
        <span aria-hidden="true" className={`absolute right-0 top-6 hidden size-11 rounded-full border-2 border-[#c8a66a] shadow-[0_2px_5px_#00000066,inset_0_1px_2px_#ffffff33] @min-[1200px]/game-layout:block [@container_game-layout_(height<500px)]:hidden ${color === "white" ? "bg-radial-[at_35%_25%] from-[#fff9e6] to-[#c6ab7d]" : "bg-radial-[at_35%_25%] from-[#303638] to-[#030506]"}`} />
      </div>
      <div className={showScore ? "flex w-full flex-col items-center gap-2 @min-[1200px]/game-layout:w-[100px] @min-[1200px]/game-layout:self-start" : "sr-only"}>
        {showScore && <PlayerScore color={color} label={label} score={score ?? 0} />}
        {active && (
          <span className="w-full max-w-28 rounded-lg bg-linear-to-b from-[#f0d18a] to-[#d1a74e] px-2 py-1 text-[clamp(9px,8cqw,14px)] font-bold leading-tight text-[#201809] [@container_game-layout_(height<500px)]:sr-only">
            {self ? t("common.yourTurn") : t("common.theirTurn")}
          </span>
        )}
      </div>
      <span className="sr-only">
        {t("common.off", { count: state.home[color] })} ·{" "}
        {t("common.bar", { count: state.bar[color] })}
      </span>
    </div>
  );
}
