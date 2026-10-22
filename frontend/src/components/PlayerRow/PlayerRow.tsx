import type { GameState, Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";
import type { PlayerDetails } from "../../types/playerDetails";
import PlayerMetrics from "./PlayerMetrics";

interface PlayerRowProps {
  color: Color;
  state: GameState;
  label: string;
  active: boolean;
  self: boolean;
  score?: number;
  details?: PlayerDetails | null;
}

export default function PlayerRow({
  color,
  state,
  label,
  active,
  self,
  score,
  details,
}: PlayerRowProps) {
  const { t } = useI18n();
  const initials = label.trim().slice(0, 2).toUpperCase();

  return (
    <div
      className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_32px] items-center gap-1 py-1 text-center text-[#f7f1e7]"
      data-player={self ? "self" : "opponent"}
    >
      {self && details && <PlayerMetrics details={details} color={color} />}
      <div className="flex min-w-0 flex-col items-center gap-1">
        <span
          className="block w-full truncate text-[clamp(11px,6cqw,18px)] font-bold"
          data-testid={`player-name-${color}`}
          title={label}
        >
          <bdi>{label}</bdi>
        </span>
        <span
          aria-hidden="true"
          data-active={active}
          className="relative grid size-[clamp(32px,46cqw,96px)] shrink-0 place-items-center rounded-full border-2 border-[#dfbc7c]/35 bg-[#211e17] text-[clamp(14px,14cqw,32px)] font-bold text-[#dfbc7c] data-[active=true]:border-amber-200 data-[active=true]:ring-2 data-[active=true]:ring-amber-200/30"
        >
          {initials}
          <span
            className={`absolute bottom-0 right-0 size-[clamp(10px,9cqw,18px)] rounded-full border border-[#dfbc7c]/60 ${color === "white" ? "bg-[#f0e3cd]" : "bg-[#171717]"}`}
          />
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        {active && (
          <span className="sr-only">
            {self ? t("common.yourTurn") : t("common.theirTurn")}
          </span>
        )}
        <span
          className="grid min-h-9 w-8 place-items-center rounded bg-[#f0e3cd] text-xl font-bold tabular-nums text-[#171717]"
          data-testid={`player-score-${color}`}
        >
          {score ?? 0}
        </span>
      </div>
      {!self && details && <PlayerMetrics details={details} color={color} />}
      <span className="col-span-2 text-[clamp(9px,4.5cqw,12px)] text-white/65">
        {t("common.off", { count: state.home[color] })} ·{" "}
        {t("common.bar", { count: state.bar[color] })}
      </span>
    </div>
  );
}
