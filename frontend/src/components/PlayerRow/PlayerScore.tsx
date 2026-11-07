import type { Color } from "@/lib/backgammon/engine";
import { useEffect, useRef } from "react";
import { useI18n } from "../../i18n/I18nProvider";

export default function PlayerScore({ color, label, score }: { color: Color; label: string; score: number }) {
  const { t } = useI18n();
  const scoreRef = useRef<HTMLSpanElement>(null);
  const previousScore = useRef(score);
  useEffect(() => {
    if (previousScore.current === score) return;
    previousScore.current = score;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation = scoreRef.current?.animate(
      reduced
        ? [{ opacity: 0.65 }, { opacity: 1 }]
        : [{ opacity: 0.65, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
      { duration: reduced ? 100 : 170, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
    return () => animation?.cancel();
  }, [score]);

  return (
    <span className="mx-auto grid min-h-[clamp(28px,5.1cqh,50px)] w-[clamp(32px,38cqw,64px)] place-items-center rounded-lg border border-[#d9b47a]/38 [background:linear-gradient(145deg,#ffffff0b,#00000028),var(--ui-secondary-bg,#2b2118)] px-1 text-[clamp(18px,16cqw,28px)] font-semibold leading-none tabular-nums text-[#f7f1e7] shadow-[inset_0_1px_0_#f0d6aa1c,0_2px_4px_#0005] [@container_game-frame_(height<700px)]:min-h-7 [@container_game-frame_(height<700px)]:w-7 [@container_game-frame_(height<700px)]:px-0.5 [@container_game-frame_(height<700px)]:text-lg"
      data-testid={`player-score-${color}`} aria-label={t("game.playerScore", { player: label, score })}>
      <span ref={scoreRef}>{score}</span>
    </span>
  );
}
