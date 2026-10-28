import type { Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";

export default function PlayerScore({ color, label, score }: { color: Color; label: string; score: number }) {
  const { t } = useI18n();
  return (
    <span className="mx-auto grid min-h-[clamp(28px,5.1cqh,50px)] w-[clamp(32px,38cqw,64px)] place-items-center rounded-lg border border-white/25 bg-white/3 px-1 text-[clamp(20px,19cqw,34px)] font-semibold leading-none tabular-nums text-[#f7f1e7] [@container_game-layout_(height<500px)]:min-h-7 [@container_game-layout_(height<500px)]:w-8 [@container_game-layout_(height<500px)]:text-xl"
      data-testid={`player-score-${color}`} aria-label={t("game.playerScore", { player: label, score })}>
      {score}
    </span>
  );
}
