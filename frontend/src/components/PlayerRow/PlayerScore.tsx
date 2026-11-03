import type { Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";

export default function PlayerScore({ color, label, score }: { color: Color; label: string; score: number }) {
  const { t } = useI18n();
  return (
    <span className="mx-auto grid min-h-[clamp(28px,5.1cqh,50px)] w-[clamp(32px,38cqw,64px)] place-items-center rounded-lg border border-white/25 bg-white/3 px-1 text-[clamp(18px,16cqw,28px)] font-semibold leading-none tabular-nums text-[#f7f1e7] [@container_game-frame_(height<700px)]:min-h-7 [@container_game-frame_(height<700px)]:w-7 [@container_game-frame_(height<700px)]:px-0.5 [@container_game-frame_(height<700px)]:text-lg"
      data-testid={`player-score-${color}`} aria-label={t("game.playerScore", { player: label, score })}>
      {score}
    </span>
  );
}
