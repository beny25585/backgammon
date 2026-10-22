import { useI18n } from "../../i18n/I18nProvider";
import type { PlayerDetails } from "../../types/playerDetails";
import CoinIcon from "./CoinIcon";

export default function PlayerMetrics({ details, color }: { details: PlayerDetails; color: string }) {
  const { t } = useI18n();
  // Match the compact account figures in the reference, including K/M suffixes in RTL.
  const coins = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[clamp(10px,6cqw,18px)] font-semibold tabular-nums" dir="ltr">
      <span className="inline-flex items-center gap-1 text-[#e7edf4]" title={t("game.rating")} aria-label={`${t("game.rating")}: ${details.rating}`} data-testid={`player-rating-${color}`}>
        <svg className="size-[1.15em] shrink-0 text-blue-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 12h5v10H2zm7-6h5v16H9zm7-5h5v21h-5z" /></svg>
        <bdi>{details.rating}</bdi>
      </span>
      <span className="inline-flex items-center gap-1 text-amber-400" title={`${t("game.accountBalance")}: ${details.balance}`} aria-label={`${t("game.accountBalance")}: ${details.balance}`} data-testid={`player-balance-${color}`}>
        <CoinIcon />
        <bdi>{coins.format(Number(details.balance))}</bdi>
      </span>
    </div>
  );
}
