import type { Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";

export default function PlayerScore({ color, label, score }: { color: Color; label: string; score: number }) {
  const { t } = useI18n();
  return (
    <span className="mx-auto grid min-h-11 w-full max-w-12 place-items-center rounded bg-[#f0e3cd] px-1 text-2xl font-bold tabular-nums text-[#171717]"
      data-testid={`player-score-${color}`} aria-label={t("game.playerScore", { player: label, score })}>
      {score}
    </span>
  );
}
