import { useI18n } from "../../i18n/I18nProvider";
import type { GameState } from "../../lib/backgammon/engine";
import CoinIcon from "../PlayerRow/CoinIcon";

export default function GameInfoCard({ state, targetPoints, leadingScore }: {
  state: GameState;
  targetPoints?: number | null;
  leadingScore?: number;
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
  const progress = typeof leadingScore === "number" && Number.isFinite(leadingScore)
    ? Math.min(targetPoints ?? 0, Math.max(0, Math.floor(leadingScore)))
    : null;
  return (
    <div className="rounded-xl border border-white/20 bg-black/10 px-2 py-3 text-[clamp(11px,11cqw,18px)] leading-snug [@container_game-layout_(height<500px)]:px-1 [@container_game-layout_(height<500px)]:py-2 [@container_game-layout_(height<500px)]:text-[11px]" dir={direction} data-testid="game-info-card">
      {isMoney ? (
        <div data-testid="game-stakes">
          <div className="flex flex-wrap items-center justify-center gap-x-1 text-[#c8bda8]">
            <span>{t("game.tableStake")}</span>
            <span className="inline-flex items-center gap-0.5 font-bold tabular-nums text-amber-400" dir="ltr" title={state.stake}><CoinIcon /><bdi>{amount.format(stake)}</bdi></span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-1 text-[#c8bda8]">
            <span>{t("game.tableLimit")}</span>
            <bdi className="font-bold tabular-nums text-slate-100" dir="ltr" title={state.lossLimit}>{amount.format(limit)}</bdi>
          </div>
        </div>
      ) : (
        <div className="text-center" data-testid="game-match-rules">
          <div className="flex flex-wrap items-center justify-center gap-x-1 text-[#c8bda8]">
            <span>{t("game.tableTarget")}</span>
            <bdi className="font-bold tabular-nums text-amber-400" data-testid="match-target">{t("game.targetPointsValue", { points: targetPoints! })}</bdi>
          </div>
          <div className="mt-1 text-[clamp(10px,8cqw,12px)] text-[#c8bda8] [@container_game-layout_(height<500px)]:mt-0.5 [@container_game-layout_(height<500px)]:text-[10px]" data-testid="match-doubling-rule">
            {state.crawfordGame
              ? t("game.crawfordRules")
              : state.doublingEnabled !== false
                ? t("game.doublingOn")
                : t("game.doublingOff")}
          </div>
          {progress !== null && targetPoints != null && (targetPoints <= 9 ? (
            <div role="progressbar" aria-label={t("game.leadingScore")} aria-valuemin={0}
              aria-valuemax={targetPoints} aria-valuenow={progress}
              aria-valuetext={t("game.matchProgressValue", { score: progress, target: targetPoints })}
              data-testid="match-progress" className="mt-2 flex items-center justify-center gap-[clamp(4px,6cqw,11px)] [@container_game-layout_(height<500px)]:mt-1">
              {Array.from({ length: targetPoints }, (_, index) => (
                <span key={index} aria-hidden="true" className={`size-[clamp(7px,9cqw,15px)] shrink-0 rounded-full border [@container_game-layout_(height<500px)]:size-1.5 ${index < progress ? "border-[#e9ca80]/80 bg-linear-to-b from-[#f0d58e] to-[#b88d3d] shadow-[inset_0_1px_1px_#ffffff40]" : "border-[#8c9693]/75 bg-transparent"}`} />
              ))}
            </div>
          ) : (
            <progress className="mt-2 h-2 w-full accent-[#d6ae63]" max={targetPoints} value={progress} aria-label={t("game.leadingScore")} />
          ))}
        </div>
      )}
    </div>
  );
}
