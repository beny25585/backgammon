import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useI18n } from "../../i18n/I18nProvider";
import { PLAYER_REACTIONS, type PlayerReaction } from "../../lib/playerReactions";

/** A permanent slot keeps scores and clocks still when a reaction arrives. */
export default function PlayerReactionBubble({ reaction }: { reaction?: PlayerReaction }) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const item = PLAYER_REACTIONS.find((candidate) => candidate.id === reaction?.reactionId);

  return (
    <div className="relative col-span-full h-8 w-full min-w-0 shrink-0" data-testid="player-reaction-slot">
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {reaction ? t(`reactions.items.${reaction.reactionId}`) : ""}
      </span>
      <AnimatePresence mode="wait">
        {reaction && item ? (
          <motion.span
            key={reaction.id}
            aria-hidden="true"
            data-testid={`player-reaction-${reaction.color}`}
            data-reaction-id={reaction.reactionId}
            initial={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(4px)" }}
            animate={{ opacity: 1, transform: "none" }}
            exit={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(4px)" }}
            transition={{ duration: reduceMotion ? 0.12 : 0.18, ease: [0.23, 1, 0.32, 1] }}
            className={`absolute inset-x-0 top-0 flex h-7 items-center justify-center rounded-lg border border-[#e6c478]/60 bg-[#302719] px-1 text-center font-semibold leading-tight text-[#ffe5a8] shadow-sm ${item.emoji ? "text-xl" : "text-[10px] @min-[1200px]/game-layout:text-xs"}`}
          >
            {item.emoji ?? t(`reactions.items.${item.id}`)}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
