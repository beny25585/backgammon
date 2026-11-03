import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useI18n } from "../../i18n/I18nProvider";
import { PLAYER_REACTIONS, type PlayerReaction } from "../../lib/playerReactions";

/** Compact display; its board host owns placement and never consumes rail space. */
export default function PlayerReactionBubble({ reaction, sender }: { reaction?: PlayerReaction; sender?: string }) {
  const { t, direction } = useI18n();
  const reduceMotion = useReducedMotion();
  const item = PLAYER_REACTIONS.find((candidate) => candidate.id === reaction?.reactionId);

  return (
    <div className="pointer-events-none relative h-16 w-max max-w-40 min-w-11 shrink-0" data-testid="player-reaction-slot" dir={direction}>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {reaction ? `${sender ? `${sender}: ` : ""}${t(`reactions.items.${reaction.reactionId}`)}` : ""}
      </span>
      <AnimatePresence mode="wait" propagate>
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
            className="relative flex min-h-12 max-w-40 flex-col items-center justify-center gap-0.5 rounded-2xl border border-[#e6c478]/45 bg-linear-to-b from-[#242b26] to-[#121a17] px-3 py-1 text-center font-semibold text-[#ffe5a8] shadow-[0_5px_16px_#00000060,inset_0_1px_0_#fff2c411] after:absolute after:-bottom-1 after:start-5 after:size-2 after:rotate-45 after:border-r after:border-b after:border-[#e6c478]/45 after:bg-[#121a17]"
          >
            {sender && <bdi className="block max-w-full truncate text-[10px] font-medium leading-3 text-[#d7cdb8]">{sender}</bdi>}
            <span className={item.emoji ? "text-[28px] leading-8" : "text-[13px] leading-5"}>
              {item.emoji ?? t(`reactions.items.${item.id}`)}
            </span>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
