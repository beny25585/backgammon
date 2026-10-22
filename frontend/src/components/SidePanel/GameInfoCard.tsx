import { useI18n } from "../../i18n/I18nProvider";
import type { GameState } from "../../lib/backgammon/engine";
import CoinIcon from "../PlayerRow/CoinIcon";

export default function GameInfoCard({ state, targetPoints }: {
  state: GameState;
  targetPoints?: number | null;
}) {
  const { t, direction } = useI18n();
  const isMoney = state.gameFormat === "money";
  const stake = Number(state.stake);
  const limit = Number(state.lossLimit);
  if (isMoney) {
    if (!Number.isFinite(stake) || !Number.isFinite(limit) || stake <= 0 || limit < stake) return null;
  } else if (targetPoints == null || !Number.isInteger(targetPoints) || targetPoints < 1) {
    return null;
  }
  const amount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
  return (
    <div className="mb-2 rounded-lg bg-[#1c2939] px-2 py-[clamp(6px,4cqw,14px)] text-[clamp(11px,7cqw,20px)] leading-snug" dir={direction} data-testid="game-info-card">
      {isMoney ? (
        <div data-testid="game-stakes">
          <div className="flex flex-wrap items-center justify-center gap-x-1 text-slate-400">
            <span>{t("game.tableStake")}</span>
            <span className="inline-flex items-center gap-0.5 font-bold tabular-nums text-amber-400" dir="ltr" title={state.stake}><CoinIcon /><bdi>{amount.format(stake)}</bdi></span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-1 text-slate-400">
            <span>{t("game.tableLimit")}</span>
            <bdi className="font-bold tabular-nums text-slate-100" dir="ltr" title={state.lossLimit}>{amount.format(limit)}</bdi>
          </div>
        </div>
      ) : (
        <div className="text-center" data-testid="game-match-rules">
          <div className="flex flex-wrap items-center justify-center gap-x-1 text-slate-400">
            <span>{t("game.tableTarget")}</span>
            <bdi className="font-bold tabular-nums text-amber-400" data-testid="match-target">{t("game.targetPointsValue", { points: targetPoints! })}</bdi>
          </div>
          <div className="text-[clamp(10px,5.5cqw,15px)] text-slate-100" data-testid="match-doubling-rule">
            {state.crawfordGame
              ? t("game.crawfordRules")
              : state.doublingEnabled !== false
                ? t("game.doublingOn")
                : t("game.doublingOff")}
          </div>
        </div>
      )}
    </div>
  );
}
